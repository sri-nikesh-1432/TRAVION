from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.db import get_db
from app.core.security import (
    verify_password, get_password_hash, create_access_token,
    get_current_identity
)
from app.core.config import settings
from app.models.entities import Identity, User, Guide, Manager, Admin, AuditLog
from app.schemas.schemas import SignupRequest, LoginRequest, TokenResponse, ElevateRequest

router = APIRouter(prefix="/auth", tags=["Auth"])

@router.post("/signup", response_model=TokenResponse)
def signup(req: SignupRequest, db: Session = Depends(get_db)):
    # Enforce unique email across all roles at database & API layer
    existing = db.query(Identity).filter(Identity.email == req.email.lower()).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"This email is already registered as a {existing.role}."
        )

    # Create identity
    hashed_pwd = get_password_hash(req.password)
    identity = Identity(
        email=req.email.lower(),
        hashed_password=hashed_pwd,
        role=req.role
    )
    db.add(identity)
    db.flush()

    user_id = None
    guide_id = None

    if req.role == "USER":
        user = User(
            identity_id=identity.id,
            first_name=req.first_name or "",
            last_name=req.last_name or "",
            preferred_name=req.first_name or "",
            phone=req.phone  # Mandatory onboarding (validated by the schema)
        )
        db.add(user)
        db.flush()
        user_id = user.id
    elif req.role == "GUIDE":
        guide = Guide(
            identity_id=identity.id,
            first_name=req.first_name or "New",
            last_name=req.last_name or "Guide",
            phone=req.phone,  # Mandatory onboarding (validated by the schema)
            approval_status="PENDING",
            status="DUTY_OFF"  # Cannot operate until verified by Manager
        )
        db.add(guide)
        db.flush()
        guide_id = guide.id

    db.commit()

    token = create_access_token({
        "sub": identity.email,
        "role": identity.role,
        "identity_id": identity.id
    })

    return TokenResponse(
        access_token=token,
        role=identity.role,
        email=identity.email,
        identity_id=identity.id,
        user_id=user_id,
        guide_id=guide_id,
        is_profile_complete=False
    )


@router.post("/guide/register", response_model=TokenResponse)
def register_guide(req: GuideRegistrationRequest, db: Session = Depends(get_db)):
    """
    Dedicated guide registration endpoint.
    Creates a GUIDE identity with PENDING verification status.
    The guide must be approved by a Manager/Admin before they can operate.
    """
    # Enforce unique email
    existing = db.query(Identity).filter(Identity.email == req.email.lower()).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"This email is already registered as a {existing.role}."
        )

    # Create identity with GUIDE role
    hashed_pwd = get_password_hash(req.password)
    identity = Identity(
        email=req.email.lower(),
        hashed_password=hashed_pwd,
        role="GUIDE"
    )
    db.add(identity)
    db.flush()

    # Create guide profile with verification pending
    guide = Guide(
        identity_id=identity.id,
        first_name=req.first_name,
        last_name=req.last_name,
        phone=req.phone,
        approval_status="PENDING",
        status="DUTY_OFF",
        languages=req.languages,
        destinations=req.destinations,
        experience_years=req.experience_years,
        specializations=[req.guide_type],
        # Profile is incomplete until onboarding details submitted
        destination_knowledge=None,
        safety_information=None
    )
    db.add(guide)
    db.flush()
    guide_id = guide.id

    db.commit()

    token = create_access_token({
        "sub": identity.email,
        "role": "GUIDE",
        "identity_id": identity.id
    })

    return TokenResponse(
        access_token=token,
        role="GUIDE",
        email=identity.email,
        identity_id=identity.id,
        guide_id=guide_id,
        is_profile_complete=False
    )

@router.post("/login", response_model=TokenResponse)
def login(req: LoginRequest, db: Session = Depends(get_db)):
    identity = db.query(Identity).filter(Identity.email == req.email.lower()).first()
    if not identity or not verify_password(req.password, identity.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password"
        )

    user_id = identity.user.id if identity.user else None
    guide_id = identity.guide.id if identity.guide else None
    is_profile_complete = False
    if identity.user:
        is_profile_complete = identity.user.is_profile_complete
    elif identity.guide:
        is_profile_complete = bool(identity.guide.destination_knowledge)

    token = create_access_token({
        "sub": identity.email,
        "role": identity.role,
        "identity_id": identity.id
    })

    return TokenResponse(
        access_token=token,
        role=identity.role,
        email=identity.email,
        identity_id=identity.id,
        user_id=user_id,
        guide_id=guide_id,
        is_profile_complete=is_profile_complete
    )

@router.post("/elevate", response_model=TokenResponse)
def elevate_access(req: ElevateRequest, db: Session = Depends(get_db)):
    """
    Manager & Admin elevation endpoint reached via hidden footer 'Authorized Access' control.
    Access code is validated server-side against protected secrets.
    Maintains a strict audit log of all elevation attempts.
    """
    target_role = None
    if req.access_code == settings.MANAGER_ELEVATION_SECRET:
        target_role = "MANAGER"
    elif req.access_code == settings.ADMIN_ELEVATION_SECRET:
        target_role = "ADMIN"
    else:
        # Audit log failed elevation attempt
        audit = AuditLog(
            action="ELEVATION_FAILED",
            actor_email=req.email,
            actor_role="UNKNOWN",
            details={"attempted_code": req.access_code}
        )
        db.add(audit)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid authorized access code. Elevation denied."
        )

    # Check if identity exists or pre-provision
    identity = db.query(Identity).filter(Identity.email == req.email.lower()).first()
    if identity:
        if not verify_password(req.password, identity.hashed_password):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid credentials for elevation"
            )
        identity.role = target_role
    else:
        # Pre-provision manager or admin account
        identity = Identity(
            email=req.email.lower(),
            hashed_password=get_password_hash(req.password),
            role=target_role
        )
        db.add(identity)
        db.flush()

        if target_role == "MANAGER":
            mgr = Manager(identity_id=identity.id, name=req.email.split("@")[0].title())
            db.add(mgr)
        elif target_role == "ADMIN":
            adm = Admin(identity_id=identity.id, name="Platform Administrator")
            db.add(adm)

    # Record successful elevation in audit log
    audit = AuditLog(
        action="ELEVATION_SUCCESS",
        actor_email=identity.email,
        actor_role=target_role,
        target_id=identity.id,
        details={"elevated_to": target_role}
    )
    db.add(audit)
    db.commit()

    token = create_access_token({
        "sub": identity.email,
        "role": identity.role,
        "identity_id": identity.id
    })

    return TokenResponse(
        access_token=token,
        role=identity.role,
        email=identity.email,
        identity_id=identity.id,
        is_profile_complete=True
    )

@router.get("/me")
def get_current_user_profile(
    current: dict = Depends(get_current_identity),
    db: Session = Depends(get_db)
):
    identity = db.query(Identity).filter(Identity.id == current["identity_id"]).first()
    if not identity:
        raise HTTPException(status_code=404, detail="Identity not found")

    res = {
        "email": identity.email,
        "role": identity.role,
        "identity_id": identity.id
    }
    if identity.user:
        res["user"] = {
            "id": identity.user.id,
            "first_name": identity.user.first_name,
            "last_name": identity.user.last_name,
            "preferred_name": identity.user.preferred_name,
            "photo_url": identity.user.photo_url,
            "age": identity.user.age,
            "gender": identity.user.gender,
            "preferred_language": identity.user.preferred_language,
            "additional_languages": identity.user.additional_languages,
            "country": identity.user.country,
            "home_city": identity.user.home_city,
            "preferred_communication": identity.user.preferred_communication,
            "emergency_contact_name": identity.user.emergency_contact_name,
            "emergency_contact_phone": identity.user.emergency_contact_phone,
            "phone": identity.user.phone,
            "is_profile_complete": identity.user.is_profile_complete
        }
    elif identity.guide:
        res["guide"] = {
            "id": identity.guide.id,
            "first_name": identity.guide.first_name,
            "last_name": identity.guide.last_name,
            "photo_url": identity.guide.photo_url,
            "status": identity.guide.status,
            "approval_status": identity.guide.approval_status,
            "languages": identity.guide.languages,
            "destinations": identity.guide.destinations,
            "experience_years": identity.guide.experience_years,
            "rating": identity.guide.rating,
            "review_count": identity.guide.review_count,
            "destination_knowledge": identity.guide.destination_knowledge,
            "safety_information": identity.guide.safety_information
        }
    return res
