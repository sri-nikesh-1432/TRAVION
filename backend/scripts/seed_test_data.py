"""
TRAVION Test Data Seed Script
==============================
Creates 20 test accounts for end-to-end testing:
- 10 USER accounts
- 5 GUIDE accounts  
- 3 MANAGER accounts
- 2 ADMIN accounts

This script is idempotent - running it multiple times will NOT create duplicates.
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from datetime import datetime, timezone, timedelta
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.core.db import Base, get_db
from app.core.security import get_password_hash, create_access_token
from app.models.entities import Identity, User, Guide, Manager, Admin
from app.core.config import settings

# Test credentials - use dummy data only
TEST_USERS = [
    {"email": "test.user01@example.test", "first_name": "Alex", "last_name": "Johnson", "phone": "+919876543210"},
    {"email": "test.user02@example.test", "first_name": "Bella", "last_name": "Smith", "phone": "+919876543211"},
    {"email": "test.user03@example.test", "first_name": "Chris", "last_name": "Williams", "phone": "+919876543212"},
    {"email": "test.user04@example.test", "first_name": "Diana", "last_name": "Brown", "phone": "+919876543213"},
    {"email": "test.user05@example.test", "first_name": "Edward", "last_name": "Jones", "phone": "+919876543214"},
    {"email": "test.user06@example.test", "first_name": "Fiona", "last_name": "Garcia", "phone": "+919876543215"},
    {"email": "test.user07@example.test", "first_name": "George", "last_name": "Miller", "phone": "+919876543216"},
    {"email": "test.user08@example.test", "first_name": "Hannah", "last_name": "Davis", "phone": "+919876543217"},
    {"email": "test.user09@example.test", "first_name": "Ian", "last_name": "Rodriguez", "phone": "+919876543218"},
    {"email": "test.user10@example.test", "first_name": "Julia", "last_name": "Martinez", "phone": "+919876543219"},
]

TEST_GUIDES = [
    {"email": "test.guide01@example.test", "first_name": "Arun", "last_name": "Kumar", "phone": "+919987654321", "languages": ["English", "Hindi", "Tamil"], "destinations": ["Chennai", "Munnar", "Kochi"], "experience_years": 5, "specializations": ["Cultural", "Historical"]},
    {"email": "test.guide02@example.test", "first_name": "Priya", "last_name": "Sharma", "phone": "+919987654322", "languages": ["English", "Hindi"], "destinations": ["Goa", "Mumbai", "Pune"], "experience_years": 3, "specializations": ["Culinary", "General"]},
    {"email": "test.guide03@example.test", "first_name": "Raj", "last_name": "Patel", "phone": "+919987654323", "languages": ["English", "Gujarati", "Hindi"], "destinations": ["Ahmedabad", "Udaipur", "Jaipur"], "experience_years": 7, "specializations": ["Historical", "Photography"]},
    {"email": "test.guide04@example.test", "first_name": "Sneha", "last_name": "Iyer", "phone": "+919987654324", "languages": ["English", "Tamil", "Malayalam"], "destinations": ["Munnar", "Kochi", "Bangalore"], "experience_years": 4, "specializations": ["Trekking", "Wildlife"]},
    {"email": "test.guide05@example.test", "first_name": "Vikram", "last_name": "Singh", "phone": "+919987654325", "languages": ["English", "Hindi"], "destinations": ["Delhi", "Agra", "Varanasi"], "experience_years": 6, "specializations": ["Historical", "Cultural"]},
]

TEST_MANAGERS = [
    {"email": "test.manager01@example.test", "name": "Operations Manager One"},
    {"email": "test.manager02@example.test", "name": "Operations Manager Two"},
    {"email": "test.manager03@example.test", "name": "Senior Operations Manager"},
]

TEST_ADMINS = [
    {"email": "test.admin01@example.test", "name": "Platform Administrator One"},
    {"email": "test.admin02@example.test", "name": "Platform Administrator Two"},
]

TEST_PASSWORD = "Test@123456"  # Strong password meeting requirements

def seed_test_data():
    """Seed test data into the database. Idempotent - safe to run multiple times."""
    
    # Get database URL from settings
    DATABASE_URL = settings.DATABASE_URL
    if not DATABASE_URL:
        print("ERROR: DATABASE_URL not configured")
        return False
    
    # Create engine and session
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False} if "sqlite" in DATABASE_URL else {})
    SessionLocal = sessionmaker(bind=engine)
    db = SessionLocal()
    
    try:
        created_count = 0
        
        print("\n" + "="*60)
        print("TRAVION Test Data Seed")
        print("="*60)
        
        # Check existing accounts
        existing_emails = set()
        for identity in db.query(Identity).filter(
            Identity.email.like("test.%")
        ).all():
            existing_emails.add(identity.email)
        
        print(f"\nFound {len(existing_emails)} existing test accounts")
        
        # Create USER accounts
        print("\n--- Creating USER accounts ---")
        for user_data in TEST_USERS:
            if user_data["email"] in existing_emails:
                print(f"  SKIP: {user_data['email']} (already exists)")
                continue
            
            identity = Identity(
                email=user_data["email"].lower(),
                hashed_password=get_password_hash(TEST_PASSWORD),
                role="USER"
            )
            db.add(identity)
            db.flush()
            
            user = User(
                identity_id=identity.id,
                first_name=user_data["first_name"],
                last_name=user_data["last_name"],
                phone=user_data["phone"],
                is_profile_complete=True
            )
            db.add(user)
            db.commit()
            db.refresh(identity)
            
            existing_emails.add(user_data["email"])
            created_count += 1
            print(f"  CREATED: {user_data['email']} (User ID: {user.id})")
        
        # Create GUIDE accounts
        print("\n--- Creating GUIDE accounts ---")
        for guide_data in TEST_GUIDES:
            if guide_data["email"] in existing_emails:
                print(f"  SKIP: {guide_data['email']} (already exists)")
                continue
            
            identity = Identity(
                email=guide_data["email"].lower(),
                hashed_password=get_password_hash(TEST_PASSWORD),
                role="GUIDE"
            )
            db.add(identity)
            db.flush()
            
            guide = Guide(
                identity_id=identity.id,
                first_name=guide_data["first_name"],
                last_name=guide_data["last_name"],
                phone=guide_data["phone"],
                status="ACTIVE",
                approval_status="APPROVED",
                languages=guide_data["languages"],
                destinations=guide_data["destinations"],
                experience_years=guide_data["experience_years"],
                specializations=guide_data["specializations"],
                rating=4.8,
                review_count=12
            )
            db.add(guide)
            db.commit()
            db.refresh(identity)
            
            existing_emails.add(guide_data["email"])
            created_count += 1
            print(f"  CREATED: {guide_data['email']} (Guide ID: {guide.id})")
        
        # Create MANAGER accounts
        print("\n--- Creating MANAGER accounts ---")
        for manager_data in TEST_MANAGERS:
            if manager_data["email"] in existing_emails:
                print(f"  SKIP: {manager_data['email']} (already exists)")
                continue
            
            identity = Identity(
                email=manager_data["email"].lower(),
                hashed_password=get_password_hash(TEST_PASSWORD),
                role="MANAGER"
            )
            db.add(identity)
            db.flush()
            
            manager = Manager(
                identity_id=identity.id,
                name=manager_data["name"]
            )
            db.add(manager)
            db.commit()
            db.refresh(identity)
            
            existing_emails.add(manager_data["email"])
            created_count += 1
            print(f"  CREATED: {manager_data['email']} (Manager ID: {manager.id})")
        
        # Create ADMIN accounts
        print("\n--- Creating ADMIN accounts ---")
        for admin_data in TEST_ADMINS:
            if admin_data["email"] in existing_emails:
                print(f"  SKIP: {admin_data['email']} (already exists)")
                continue
            
            identity = Identity(
                email=admin_data["email"].lower(),
                hashed_password=get_password_hash(TEST_PASSWORD),
                role="ADMIN"
            )
            db.add(identity)
            db.flush()
            
            admin = Admin(
                identity_id=identity.id,
                name=admin_data["name"]
            )
            db.add(admin)
            db.commit()
            db.refresh(identity)
            
            existing_emails.add(admin_data["email"])
            created_count += 1
            print(f"  CREATED: {admin_data['email']} (Admin ID: {admin.id})")
        
        print("\n" + "="*60)
        print(f"Seed complete: {created_count} new accounts created")
        print(f"Total test accounts: {len(existing_emails)}")
        print("="*60)
        print(f"\nTest Password for all accounts: {TEST_PASSWORD}")
        print("\nTest Credentials Summary:")
        print("-"*40)
        print("USERS (10):")
        for u in TEST_USERS:
            print(f"  {u['email']} / {TEST_PASSWORD}")
        print("\nGUIDES (5):")
        for g in TEST_GUIDES:
            print(f"  {g['email']} / {TEST_PASSWORD}")
        print("\nMANAGERS (3):")
        for m in TEST_MANAGERS:
            print(f"  {m['email']} / {TEST_PASSWORD}")
        print("\nADMINS (2):")
        for a in TEST_ADMINS:
            print(f"  {a['email']} / {TEST_PASSWORD}")
        print("="*60)
        
        return True
        
    except Exception as e:
        db.rollback()
        print(f"\nERROR: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        db.close()


if __name__ == "__main__":
    success = seed_test_data()
    sys.exit(0 if success else 1)
