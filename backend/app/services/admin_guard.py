import time
import uuid
import json
import logging
from typing import Callable, Any
from fastapi import HTTPException
from sqlalchemy.orm import Session
from app.models.marketplace import AdminActionLog, IdempotencyKey
from app.services import metrics_service

logger = logging.getLogger(__name__)

async def send_admin_alert(event_type: str, payload: dict):
    """Phase 7: Alerting Stub."""
    metrics_service.send_financial_alert(f"admin_{event_type}", payload)

def execute_admin_mutation(
    db: Session,
    actor: dict, # {"actor_id": str, "role": str}
    action_type: str,
    target_id: str,
    mutation_fn: Callable[[], dict], # Returns response dict
    validation_fn: Callable[[], str] | None = None, # Returns current_status
    dry_run: bool = False,
    idempotency_key: str | None = None,
    validation_payload: dict | None = None, # {"confirm": bool, "reason": str, "expected_status": str}
    rate_limit_max: int = 10,
    debug_mode: bool = False
) -> dict:
    actor_id = actor["actor_id"]
    role = actor["role"]
    now = int(time.time())
    
    # 1. Rate Limiting (Phase 3)
    recent_actions = db.query(AdminActionLog).filter(
        AdminActionLog.actor_id == actor_id,
        AdminActionLog.created_at >= now - 60
    ).count()
    if recent_actions >= rate_limit_max:
        raise HTTPException(status_code=429, detail=f"Rate limit exceeded (max {rate_limit_max}/min)")
        
    # 2. Idempotency Check (Phase 4)
    if idempotency_key:
        scoped_key = f"admin:{action_type}:{idempotency_key}"
        idem = db.get(IdempotencyKey, scoped_key)
        if idem:
            # Phase 4: Reject duplicates, do NOT replay old responses
            raise HTTPException(status_code=409, detail="Duplicate idempotency key. Action already processed.")
            
    # 3. Required Fields & State Validation (Phase 3, 5)
    if not validation_payload or not validation_payload.get("confirm"):
        raise HTTPException(status_code=400, detail="Explicit 'confirm' flag required for admin mutations")
    if not validation_payload.get("reason") or len(validation_payload.get("reason", "")) < 5:
        raise HTTPException(status_code=400, detail="Valid 'reason' (min 5 chars) required for audit")
        
    if validation_fn and validation_payload.get("expected_status"):
        current_status = validation_fn()
        if current_status != validation_payload.get("expected_status"):
            raise HTTPException(
                status_code=409, 
                detail=f"State mismatch: current={current_status}, expected={validation_payload.get('expected_status')}"
            )
                
    # 4. Dry Run (Phase 6)
    # Allow only if DEBUG = true OR role == admin
    if dry_run:
        if not debug_mode and role != "admin":
            raise HTTPException(status_code=403, detail="Dry run only allowed for admin role or in debug mode")
        return {
            "status": "success",
            "action": action_type,
            "target_id": target_id,
            "dry_run": True,
            "message": "[DRY RUN] Action validated but not executed."
        }
        
    # 5. Execution & Logging (Phase 1)
    log_status = "failure"
    error_message = None
    response_data = {}
    
    try:
        response_data = mutation_fn()
        log_status = "success"
        
        if idempotency_key:
            scoped_key = f"admin:{action_type}:{idempotency_key}"
            db.add(IdempotencyKey(
                key=scoped_key,
                created_at=now,
                user_id=actor_id,
                request_path=f"admin_action:{action_type}",
                response_status=200,
                response_body=None # Phase 4: do NOT replay old responses
            ))
            
    except HTTPException as e:
        error_message = e.detail
        raise e
    except Exception as e:
        error_message = str(e)
        logger.exception(f"Admin action failed: {action_type} on {target_id}")
        raise HTTPException(status_code=500, detail=f"Admin action failed: {error_message}")
    finally:
        log = AdminActionLog(
            id=str(uuid.uuid4()),
            actor_id=actor_id,
            role=role,
            action_type=action_type,
            target_id=target_id,
            idempotency_key=idempotency_key,
            status=log_status,
            error_message=error_message,
            metadata_json=json.dumps(validation_payload) if validation_payload else None,
            created_at=now
        )
        db.add(log)
        db.commit()
        
    # Phase 7: Alerting
    if log_status == "success" and action_type in ["cancel_booking", "retry_transfer"]:
        import asyncio
        loop = asyncio.get_event_loop()
        alert_payload = {
            "booking_id": target_id,
            "actor": actor_id,
            "action": action_type,
            "reason": validation_payload.get("reason")
        }
        if loop.is_running():
            loop.create_task(send_admin_alert(action_type, alert_payload))
            
    return response_data
