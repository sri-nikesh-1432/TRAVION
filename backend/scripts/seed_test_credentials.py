"""
TRAVION — test credential seeder (run once per fresh backend/db).

Creates deterministic, documented test accounts across all four roles so E2E
and manual QA can use real credentials without inventing ad-hoc users.

Run:
    cd backend && python scripts/seed_test_credentials.py

Passwords are strong (meeting the backend policy: >=8 chars, upper + lower +
digit). Emails are namespaced under test.*/admin*@travion.in so they never
collide with real production signups during a local run.
"""
from app.core.db import SessionLocal
from app.core.security import get_password_hash
from app.models.entities import Identity, User, Guide, Manager, Admin

# ---------------------------------------------------------------------------
# One shared strong password per role class (documented here for QA).
# ---------------------------------------------------------------------------
USER_PASSWORD = "TravionUser1"
GUIDE_PASSWORD = "TravionGuide2"
MANAGER_PASSWORD = "TravionMgr3"
ADMIN_PASSWORD = "TravionAdmin4"

USERS = [
    ("priya.malhotra@example.com", "Priya", "Malhotra"),
    ("arjun.sethi@example.com", "Arjun", "Sethi"),
    ("meena.kapoor@example.com", "Meena", "Kapoor"),
    ("vikram.rao@example.com", "Vikram", "Rao"),
    ("ananya.sharma@example.com", "Ananya", "Sharma"),
]

GUIDES = [
    ("kavya.nilgiri@example.com", "Kavya", "Pillai"),       # Ooty / Nilgiris
    ("raj.alleppey@example.com", "Raj", "Menon"),           # Kerala backwaters
    ("inder.Manali@example.com", "Inder", "Singh"),         # Himachal
    ("gopal.goa@example.com", "Gopal", "Pereira"),          # Goa
    ("neha.jaipur@example.com", "Neha", "Verma"),           # Rajasthan
]

MANAGERS = [
    ("manager.tamil@example.com", "Operations - Tamil Nadu"),
    ("manager.kerala@example.com", "Operations - Kerala"),
    ("manager.north@example.com", "Operations - North"),
    ("manager.west@example.com", "Operations - West"),
    ("manager.east@example.com", "Operations - East"),
]

ADMINS = [
    ("admin.finance@example.com", "Finance Admin"),
    ("admin.ops@example.com", "Operations Admin"),
    ("admin.support@example.com", "Support Admin"),
]


def seed():
    db = SessionLocal()
    try:
        created = 0

        for email, first_name, last_name in USERS:
            if db.query(Identity).filter(Identity.email == email).first():
                continue
            ident = Identity(
                email=email,
                hashed_password=get_password_hash(USER_PASSWORD),
                role="USER",
            )
            db.add(ident)
            db.flush()
            db.add(User(
                identity_id=ident.id,
                first_name=first_name,
                last_name=last_name,
                preferred_name=first_name,
                phone="+919999000000",
                is_profile_complete=True,
            ))
            db.commit()
            created += 1

        for email, first_name, last_name in GUIDES:
            if db.query(Identity).filter(Identity.email == email).first():
                continue
            ident = Identity(
                email=email,
                hashed_password=get_password_hash(GUIDE_PASSWORD),
                role="GUIDE",
            )
            db.add(ident)
            db.flush()
            db.add(Guide(
                identity_id=ident.id,
                first_name=first_name,
                last_name=last_name,
                status="ACTIVE",
                approval_status="APPROVED",
                languages=["English", "Hindi"],
                destinations=["Ooty", "Munnar", "Manali", "Goa", "Jaipur"],
                experience_years=5,
                rating=4.8,
                review_count=24,
                destination_knowledge="Certified local guide with verified destination knowledge.",
                safety_information="Carries first-aid kit and knows local emergency contacts.",
            ))
            db.commit()
            created += 1

        for email, name in MANAGERS:
            if db.query(Identity).filter(Identity.email == email).first():
                continue
            ident = Identity(
                email=email,
                hashed_password=get_password_hash(MANAGER_PASSWORD),
                role="MANAGER",
            )
            db.add(ident)
            db.flush()
            db.add(Manager(identity_id=ident.id, name=name))
            db.commit()
            created += 1

        for email, name in ADMINS:
            if db.query(Identity).filter(Identity.email == email).first():
                continue
            ident = Identity(
                email=email,
                hashed_password=get_password_hash(ADMIN_PASSWORD),
                role="ADMIN",
            )
            db.add(ident)
            db.flush()
            db.add(Admin(identity_id=ident.id, name=name))
            db.commit()
            created += 1

        print(f"[seed] created {created} test credentials")
        print(f"[seed] USER password: {USER_PASSWORD}")
        print(f"[seed] GUIDE password: {GUIDE_PASSWORD}")
        print(f"[seed] MANAGER password: {MANAGER_PASSWORD}")
        print(f"[seed] ADMIN password: {ADMIN_PASSWORD}")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
