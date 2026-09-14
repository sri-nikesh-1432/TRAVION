# Shared pytest configuration.
#
# The developer machine / CI may have REAL Razorpay test keys in backend/.env.
# Unit tests must stay deterministic and offline: force the placeholder keys
# (simulation mode) for the whole test session. The simulation path is the
# full signature-verification architecture — server-issued HMAC, forged
# signatures rejected — just without the external network dependency.
import pytest

from app.core.config import settings

_PLACEHOLDER_KEY_ID = "rzp_test_travion_live"
_PLACEHOLDER_KEY_SECRET = "travion_sec_verified_razorpay"


@pytest.fixture(scope="session", autouse=True)
def force_payment_simulation_mode():
    original = (settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET)
    settings.RAZORPAY_KEY_ID = _PLACEHOLDER_KEY_ID
    settings.RAZORPAY_KEY_SECRET = _PLACEHOLDER_KEY_SECRET
    yield
    settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET = original
