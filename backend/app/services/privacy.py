"""Phone number privacy helpers.

Product policy: full phone numbers are never exposed across roles or in the
UI. Any API payload that includes a phone number must pass it through
mask_phone() before returning it. Masking keeps the country code and first 7
digits of the local number (consistent with the product's stated display
format "+91 830959****") and hides the rest.
"""
from typing import Optional

_VISIBLE_TAIL = 4  # digits kept visible at the end is 0; we keep prefix visible


def mask_phone(phone: Optional[str]) -> Optional[str]:
    """Return a display-safe phone like '+91 830959****' or None."""
    if not phone:
        return None
    digits = "".join(c for c in str(phone) if c.isdigit())
    if not digits:
        return None
    # Normalize: strip leading 0s; detect country code.
    local = digits
    country = "+91"
    if len(digits) == 12 and digits.startswith("91"):
        local = digits[2:]
    elif len(digits) == 13 and digits.startswith("091"):
        local = digits[3:]
    elif len(digits) > 10:
        country = f"+{digits[:-10]}"
        local = digits[-10:]
    elif len(digits) < 10:
        # Too short to be a real local number — mask almost everything.
        return f"{country} {'*' * max(0, 6 - len(digits))}{digits[-1:]}" if digits else None

    visible = local[:6]
    masked = visible + "*" * (len(local) - len(visible))
    formatted = f"{country} {masked}" if masked else country
    return formatted
