"""Budget snapshot + persisted top-ups (master spec §8/§11/§14).

Two guarantees live here:

1. ONE authoritative base budget per trip (`trips.budget`, kept in sync with
   the interview answer by discovery). Every stage reads the same number —
   Plan, Review, Payment and both dashboards reconcile against it.
2. A top-up is a BUDGET ADJUSTMENT, never a payment: it writes an immutable
   `budget_adjustments` trail (previous → adjustment → updated, actor, stage,
   reason, timestamp) plus an audit event, and it NEVER creates a Payment row.

The 20% place-selection protection (spec §11) is computed here as well. It is
NOT the 15% final safety reserve (that one is inside the pricing engine);
confusing the two would either double-reserve or under-protect the traveller.

Endpoints (all authenticated; ownership enforced by `_own_trip`):
    GET  /trips/{trip_id}/budget               → full snapshot (read)
    POST /trips/{trip_id}/budget/topup-preview → compute only, no writes
    POST /trips/{trip_id}/budget/topup         → persist the adjustment
"""
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import require_role
from app.models.entities import (
    AuditLog, BudgetAdjustment, Trip, TripProfile, User, get_utc_now,
)
from app.schemas.schemas import (
    BudgetAdjustmentItem, BudgetSnapshotResponse, BudgetTopupPreviewRequest,
    BudgetTopupPreviewResponse, BudgetTopupRequest, BudgetTopupResponse,
    PlaceStageBudget,
)
from app.api.v1.trip_edit import _own_trip

router = APIRouter(prefix="/trips", tags=["Budget"])

# Spec §11: protect 20% of the pre-selection remaining budget while places are
# being chosen (distinct from the 15% safety reserve applied at pricing time).
PLACE_SELECTION_BUFFER_RATE = 0.20

# Sanity caps for a single adjustment — a top-up is a budget edit, not a
# transfer. Custom amounts above this need an operator (Manager/Admin) path.
MAX_SINGLE_TOPUP = 5_000_000.0
MIN_SINGLE_TOPUP = 1.0

TOPUP_STAGES = {"transport", "places", "local_transport", "plan", "review", "other"}


# ── Shared budget math (the single source of truth for this router) ──────────

def _committed_breakdown(db: Session, trip_id: str) -> Dict[str, float]:
    """Committed base-trip expenses from the authoritative selections ledger.

    Only rows with status='active' count (removed places never double-book
    budget). The stay and paid activities are selection rows here; restaurant
    rows carry no price at selection stage (food is priced in Plan, spec §9).
    """
    from app.models.entities import TripPlaceSelection
    rows: List[TripPlaceSelection] = (
        db.query(TripPlaceSelection)
        .filter(
            TripPlaceSelection.trip_id == trip_id,
            TripPlaceSelection.status == "active",
        )
        .all()
    )
    selection_total = round(sum(float(r.price or 0.0) for r in rows), 2)
    stay_total = round(
        sum(float(r.price or 0.0) for r in rows if str(r.category or "").lower() in ("stay", "stays", "hotel")),
        2,
    )
    return {
        "selection_total": selection_total,
        "stay_total": stay_total,
        "activity_total": round(max(selection_total - stay_total, 0.0), 2),
    }


def _base_budget(trip: Trip) -> float:
    """The trip's authoritative BASE trip spending budget (spec §4.1)."""
    return round(float(trip.budget or 0.0), 2)


def build_budget_snapshot(db: Session, trip: Trip) -> Dict[str, Any]:
    """Everything the top-up popup and the place-selection gate need, computed
    in exactly one place so no two screens can disagree (spec §8/§11/§14)."""
    base = _base_budget(trip)
    committed = _committed_breakdown(db, trip.id)
    selection_total = committed["selection_total"]
    committed_total = selection_total  # selections are the only committed base spend

    remaining = round(base - committed_total, 2)

    # 20% protection is taken from the budget BEFORE place selection is
    # applied (spec §11 example: remaining ₹50,000 → protect ₹10,000 →
    # allowance ₹40,000). Other committed costs (transport etc.) reduce the
    # pre-selection remainder first; today selections are the only committed
    # line, so pre_remaining == base.
    other_committed = round(max(committed_total - selection_total, 0.0), 2)
    pre_remaining = round(base - other_committed, 2)
    protected = round(max(pre_remaining, 0.0) * PLACE_SELECTION_BUFFER_RATE, 2)
    allowance = round(max(pre_remaining, 0.0) - protected, 2)

    within = selection_total <= allowance + 1e-9
    exceeds = round(max(selection_total - allowance, 0.0), 2)

    adjustments = (
        db.query(BudgetAdjustment)
        .filter(BudgetAdjustment.trip_id == trip.id)
        .order_by(BudgetAdjustment.created_at.desc(), BudgetAdjustment.id.desc())
        .all()
    )

    return {
        "trip_id": trip.id,
        "currency": "INR",
        "base_budget": base,
        "committed_expenses": round(committed_total, 2),
        "remaining_budget": remaining,
        "place_stage": {
            "selection_total": round(selection_total, 2),
            "protected_buffer": protected,
            "place_selection_allowance": allowance,
            "within_allowance": bool(within),
            "exceeds_by": exceeds,
        },
        "adjustments": [_adjustment_item(a) for a in adjustments],
    }


def _adjustment_item(a: BudgetAdjustment) -> Dict[str, Any]:
    return {
        "id": a.id,
        "previous_budget": float(a.previous_budget or 0.0),
        "adjustment_amount": float(a.adjustment_amount or 0.0),
        "updated_budget": float(a.updated_budget or 0.0),
        "currency": a.currency or "INR",
        "stage": a.stage or "plan",
        "reason": a.reason,
        "actor_email": a.actor_email or "",
        "actor_role": a.actor_role or "",
        "created_at": a.created_at,
    }


def _validate_amount(amount: float) -> float:
    try:
        value = float(amount)
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=422,
            detail={"error_code": "INVALID_TOPUP_AMOUNT",
                    "message": "Enter a valid top-up amount in ₹."},
        )
    if value != value or value in (float("inf"), float("-inf")):  # NaN / inf
        raise HTTPException(
            status_code=422,
            detail={"error_code": "INVALID_TOPUP_AMOUNT",
                    "message": "Enter a valid top-up amount in ₹."},
        )
    if value < MIN_SINGLE_TOPUP:
        raise HTTPException(
            status_code=422,
            detail={"error_code": "INVALID_TOPUP_AMOUNT",
                    "message": "Top-up must be at least ₹1."},
        )
    if value > MAX_SINGLE_TOPUP:
        raise HTTPException(
            status_code=422,
            detail={"error_code": "TOPUP_TOO_LARGE",
                    "message": "A single top-up can be at most ₹50,00,000. "
                               "Contact operations for larger budget revisions."},
        )
    return round(value, 2)


def _apply_to_profile(profile: Optional[TripProfile], new_base: float) -> None:
    """Keep the interview's stored budget envelope in step with trips.budget so
    the feasibility gate (`_raw_budget`) and the snapshot can never disagree."""
    if not profile:
        return
    answers = dict(profile.questions_answers or {})
    budget_val = answers.get("budget")
    if isinstance(budget_val, dict):
        try:
            lo = float(budget_val.get("min") or budget_val.get("from") or 0)
        except (TypeError, ValueError):
            lo = 0.0
        if lo > new_base:
            lo = new_base
        answers["budget"] = {"min": lo, "max": new_base}
        profile.questions_answers = answers
    elif budget_val is not None:
        # Non-numeric legacy answer — replace with the authoritative numbers.
        answers["budget"] = {"min": round(new_base * 0.8, 2), "max": new_base}
        profile.questions_answers = answers


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/{trip_id}/budget", response_model=BudgetSnapshotResponse)
def budget_snapshot(
    trip_id: str,
    current: dict = Depends(require_role("USER", "GUIDE", "MANAGER", "ADMIN")),
    db: Session = Depends(get_db),
):
    """Full budget snapshot: base budget, committed spend, remaining amount,
    the 20% place-selection protection numbers and the full top-up history."""
    trip = _own_trip(trip_id, current, db)
    return build_budget_snapshot(db, trip)


@router.post("/{trip_id}/budget/topup-preview", response_model=BudgetTopupPreviewResponse)
def topup_preview(
    trip_id: str,
    req: BudgetTopupPreviewRequest,
    current: dict = Depends(require_role("USER", "GUIDE", "MANAGER", "ADMIN")),
    db: Session = Depends(get_db),
):
    """Compute the updated totals for a proposed top-up WITHOUT persisting
    anything — the confirmation dialog shows exactly what will be saved."""
    trip = _own_trip(trip_id, current, db)
    amount = _validate_amount(req.amount)
    previous = _base_budget(trip)
    updated = round(previous + amount, 2)
    committed = _committed_breakdown(db, trip.id)["selection_total"]
    return {
        "previous_budget": previous,
        "amount": amount,
        "updated_budget": updated,
        "updated_remaining": round(updated - committed, 2),
        "currency": "INR",
    }


@router.post("/{trip_id}/budget/topup", response_model=BudgetTopupResponse)
def confirm_topup(
    trip_id: str,
    req: BudgetTopupRequest,
    current: dict = Depends(require_role("USER", "MANAGER", "ADMIN")),
    db: Session = Depends(get_db),
):
    """Persist a confirmed budget top-up (spec §8/§10/§14):

        new base budget = previous base budget + adjustment_amount

    Writes `budget_adjustments` (before/after, actor, stage, reason), updates
    `trips.budget` and the interview envelope, and records an audit event.
    NEVER creates a Payment row — no money is collected by a budget edit.
    """
    trip = _own_trip(trip_id, current, db)

    if req.stage not in TOPUP_STAGES:
        raise HTTPException(
            status_code=422,
            detail={"error_code": "INVALID_STAGE",
                    "message": f"Unknown workflow stage '{req.stage}'."},
        )
    amount = _validate_amount(req.amount)

    previous = _base_budget(trip)
    updated = round(previous + amount, 2)
    user = db.query(User).filter(User.identity_id == current["identity_id"]).first()

    adjustment = BudgetAdjustment(
        trip_id=trip.id,
        actor_id=user.id if user else None,
        actor_email=str(current.get("email") or ""),
        actor_role=str(current.get("role") or "USER"),
        previous_budget=previous,
        adjustment_amount=amount,
        updated_budget=updated,
        currency="INR",
        stage=req.stage,
        reason=req.reason,
    )
    db.add(adjustment)

    trip.budget = updated
    trip.updated_at = get_utc_now()
    _apply_to_profile(trip.profile, updated)

    db.add(AuditLog(
        action="BUDGET_TOPUP",
        actor_email=str(current.get("email") or ""),
        actor_role=str(current.get("role") or "USER"),
        target_id=trip.id,
        details={
            "previous_budget": previous,
            "adjustment_amount": amount,
            "updated_budget": updated,
            "currency": "INR",
            "stage": req.stage,
        },
    ))

    try:
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error_code": "TOPUP_SAVE_FAILED",
                    "message": "The top-up could not be saved. Nothing was changed."},
        )
    db.refresh(adjustment)

    return {
        "snapshot": build_budget_snapshot(db, trip),
        "adjustment": _adjustment_item(adjustment),
    }
