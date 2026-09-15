from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.db import get_db
from app.core.security import require_role
from app.models.entities import ContactMessage
from app.schemas.schemas import ContactMessageCreate, ContactMessageResponse

router = APIRouter(prefix="", tags=["Support"])

@router.post("/support/contact", response_model=ContactMessageResponse, status_code=status.HTTP_201_CREATED)
def create_contact_message(
    req: ContactMessageCreate,
    db: Session = Depends(get_db)
):
    """Public: a visitor submits the contact form. Purely additive — no account
    is required, no auth token is needed, and the row is triaged by managers."""
    msg = ContactMessage(
        name=req.name.strip()[:120],
        email=req.email.strip().lower(),
        topic=req.topic,
        priority=req.priority,
        message=req.message.strip(),
        status="NEW",
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)
    return msg

@router.get("/support/contact", response_model=List[ContactMessageResponse])
def list_contact_messages(
    current: dict = Depends(require_role("MANAGER", "ADMIN")),
    db: Session = Depends(get_db)
):
    """Staff-only triage queue — newest first, so fresh reports are seen first."""
    return (
        db.query(ContactMessage)
        .order_by(ContactMessage.created_at.desc())
        .all()
    )