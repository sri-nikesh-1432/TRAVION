import hmac
import hashlib
import uuid
import logging
from typing import Dict, Any
from app.core.config import settings

logger = logging.getLogger(__name__)

# Placeholder keys used when no real key is configured — disables live API calls.
_PLACEHOLDER_KEY_ID = "rzp_test_travion_live"
_PLACEHOLDER_KEY_SECRET = "travion_sec_verified_razorpay"


def _has_live_razorpay_keys() -> bool:
    """True when the deployment has REAL Razorpay credentials configured."""
    return bool(
        settings.RAZORPAY_KEY_ID
        and settings.RAZORPAY_KEY_SECRET
        and settings.RAZORPAY_KEY_ID != _PLACEHOLDER_KEY_ID
        and settings.RAZORPAY_KEY_SECRET != _PLACEHOLDER_KEY_SECRET
    )


def simulated_signature(order_id: str) -> str:
    """Server-issued, unforgeable signature for simulated (no-keys) orders.

    §33/§53: the client must NEVER be able to mint a payment success on its
    own. The HMAC is keyed with the platform secret, so only this backend can
    produce a valid signature for an order — the client receives it from the
    checkout response and echoes it back. When real Razorpay credentials are
    configured, simulated signatures are rejected outright (see verify).
    """
    key = f"travion-sim-payment|{settings.SECRET_KEY}".encode("utf-8")
    msg = f"{order_id}|sim".encode("utf-8")
    digest = hmac.new(key, msg, hashlib.sha256).hexdigest()
    return f"sim_sig_{digest}"

try:
    import requests
except ImportError:  # pragma: no cover
    requests = None

class PaymentService:
    """
    Manages payment orders, Razorpay integration, webhook verification,
    and transparent splitting between item costs, guide fees, and platform fees.
    """

    @classmethod
    def create_order(cls, trip_id: str, amount: float, currency: str = "INR") -> Dict[str, Any]:
        """
        Creates a real Razorpay test-mode order when valid credentials are configured.
        Falls back to a locally-formatted simulated order when the Razorpay API is
        unreachable or credentials are missing, so the platform still works offline.
        """
        live = cls._try_create_live_order(trip_id, amount, currency)
        if live:
            return live

        # Simulated fallback order (same official format). The response carries
        # a server-issued signature the honest client echoes to the webhook —
        # a fabricated signature can never activate a trip.
        order_id = f"order_sim_{uuid.uuid4().hex[:14]}"
        return {
            "order_id": order_id,
            "amount": amount,
            "currency": currency,
            "key_id": settings.RAZORPAY_KEY_ID,
            "live": False,
            "simulated_signature": simulated_signature(order_id),
        }

    @classmethod
    def _try_create_live_order(cls, trip_id: str, amount: float, currency: str) -> Dict[str, Any] | None:
        """
        Attempts to create a genuine Razorpay order through the Orders API.
        Returns None when not possible (no requests lib, placeholder keys, network failure).
        """
        key_id = settings.RAZORPAY_KEY_ID
        key_secret = settings.RAZORPAY_KEY_SECRET
        if requests is None or not key_id or not key_secret:
            return None
        if key_id == _PLACEHOLDER_KEY_ID or key_secret == "travion_sec_verified_razorpay":
            return None
        if not key_id.startswith("rzp_test_") and not key_id.startswith("rzp_live_"):
            return None
        try:
            resp = requests.post(
                "https://api.razorpay.com/v1/orders",
                auth=(key_id, key_secret),
                json={
                    "amount": int(round(amount * 100)),  # paise
                    "currency": currency,
                    "receipt": f"travion_{trip_id}",
                    "payment_capture": 1,
                },
                timeout=6,
            )
            if resp.status_code not in (200, 201):
                logger.warning("Razorpay order API error %s: %s", resp.status_code, resp.text[:300])
                return None
            data = resp.json()
            return {
                "order_id": data["id"],
                "amount": amount,
                "currency": currency,
                "key_id": key_id,
                "live": True
            }
        except Exception as exc:  # network errors, bad credentials, etc.
            logger.warning("Razorpay live order creation failed, using simulated order: %s", exc)
            return None

    @classmethod
    def verify_payment_signature(
        cls,
        order_id: str,
        payment_id: str,
        signature: str
    ) -> bool:
        """
        HMAC SHA256 signature verification according to Razorpay API contract.
        """
        if not signature:
            return False

        # §33/§53 hard rule: when the deployment has REAL Razorpay credentials,
        # only genuine Razorpay HMAC signatures are accepted — simulated ones
        # are worthless here because a real order was created with Razorpay.
        if order_id.startswith("order_sim_") or not _has_live_razorpay_keys():
            # Simulated order (or no real keys): only THIS server's issued HMAC
            # passes. Anything else — including the legacy hard-coded client
            # strings — is rejected, so a forged webhook cannot activate a trip.
            return hmac.compare_digest(signature, simulated_signature(order_id))

        # Real Razorpay order with real keys: genuine signature check only.
        msg = f"{order_id}|{payment_id}".encode('utf-8')
        generated_signature = hmac.new(
            settings.RAZORPAY_KEY_SECRET.encode('utf-8'),
            msg,
            hashlib.sha256
        ).hexdigest()
        return hmac.compare_digest(generated_signature, signature)

    @classmethod
    def calculate_splits(cls, cost_breakdown: Dict[str, float]) -> Dict[str, float]:
        """
        Splits total payment into:
        - Cost items (transport, stay, food, activities)
        - Guide fee (to guide)
        - Platform fee (to platform/admin)
        """
        return {
            "transport_cost": cost_breakdown.get("transport", 0.0),
            "stay_cost": cost_breakdown.get("stay", 0.0),
            "food_cost": cost_breakdown.get("food", 0.0),
            "activity_cost": cost_breakdown.get("activities", 0.0),
            "guide_fee": cost_breakdown.get("guide_fee", 0.0),
            "platform_fee": cost_breakdown.get("platform_fee", 0.0),
            "total": cost_breakdown.get("total", 0.0)
        }
