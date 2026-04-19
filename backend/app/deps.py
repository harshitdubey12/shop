from typing import Annotated

from fastapi import Depends, Header, HTTPException, status

from app.config import Settings, get_settings


def require_route_enabled(settings: Annotated[Settings, Depends(get_settings)]) -> Settings:
    if not settings.razorpay_route_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Razorpay Route mode is disabled (RAZORPAY_ROUTE_ENABLED=false).",
        )
    return settings


def optional_internal_key(
    settings: Annotated[Settings, Depends(get_settings)],
    x_route_internal_key: Annotated[str | None, Header(alias="X-Route-Internal-Key")] = None,
) -> None:
    expected = settings.route_internal_api_key
    if not expected:
        return
    if not x_route_internal_key or x_route_internal_key != expected:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or missing internal API key")


from fastapi import Request
import json

def parse_keys_json(json_str: str) -> dict:
    try:
        return json.loads(json_str)
    except:
        return {}

def require_admin_role(min_role: str = "viewer"):
    def role_dependency(
        request: Request,
        settings: Annotated[Settings, Depends(get_settings)],
        x_admin_key: Annotated[str | None, Header(alias="X-Admin-Key")] = None,
    ) -> dict:
        if not x_admin_key:
            raise HTTPException(status_code=401, detail="Missing X-Admin-Key")
            
        api_keys = parse_keys_json(settings.admin_api_keys_json)
        auth_info = api_keys.get(x_admin_key)
        
        if not auth_info:
            raise HTTPException(status_code=401, detail="Invalid API key")
            
        current_role = auth_info.get("role")
        actor_id = auth_info.get("actor_id")
        
        if not current_role or not actor_id:
            raise HTTPException(status_code=401, detail="Malformed auth info")
            
        role_levels = {"viewer": 1, "operator": 2, "admin": 3}
        if role_levels.get(current_role, 0) < role_levels.get(min_role, 0):
            raise HTTPException(status_code=403, detail=f"Insufficient role. Requires {min_role}")
            
        return {"actor_id": actor_id, "role": current_role}
    return role_dependency
