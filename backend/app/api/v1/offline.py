from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.db import get_db
from app.core.security import require_role
from app.models.entities import Trip, Itinerary, OfflinePackage
from app.services.offline_service import OfflinePackageService

router = APIRouter(prefix="/trips", tags=["Offline"])

@router.get("/{trip_id}/offline-package")
def get_offline_package(
    trip_id: str,
    current: dict = Depends(require_role("USER", "GUIDE")),
    db: Session = Depends(get_db)
):
    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")

    pkg = db.query(OfflinePackage).filter(OfflinePackage.trip_id == trip.id).first()
    if not pkg:
        # Generate on the fly
        itinerary = db.query(Itinerary).filter(Itinerary.trip_id == trip.id, Itinerary.is_active == True).first()
        bundle = OfflinePackageService.assemble_package(
            trip_data={"id": trip.id, "source_name": trip.source_name, "destination_name": trip.destination_name, "start_datetime": trip.start_datetime, "end_datetime": trip.end_datetime, "mode": trip.mode},
            itinerary_data=itinerary.days_data if itinerary else [],
            profile_data=trip.profile.questions_answers if trip.profile else {}
        )
        pkg = OfflinePackage(trip_id=trip.id, package_data=bundle)
        db.add(pkg)
        db.commit()
        db.refresh(pkg)

    return pkg.package_data
