"""Notification center API routes."""

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.schemas.app_setting import NotificationTestResponse
from app.schemas.notification import (
    CustomEventPayload,
    NotificationChannelGroupPayload,
    NotificationChannelGroupResponse,
    NotificationChannelPayload,
    NotificationChannelResponse,
    NotificationContactGroupPayload,
    NotificationContactGroupResponse,
    NotificationContactPayload,
    NotificationContactResponse,
    NotificationDeliveryListResponse,
    NotificationOverviewResponse,
    NotificationRulePayload,
    NotificationRuleResponse,
    NotificationTemplatePayload,
    NotificationTemplateResponse,
    NotificationTestPayload,
)
from app.services import notification_center_service as service


router = APIRouter()


@router.get("/notifications/overview", response_model=NotificationOverviewResponse)
def get_notification_overview(db: Session = Depends(get_db)) -> NotificationOverviewResponse:
    """Return aggregate alert and channel health counters."""
    return service.get_overview(db)


@router.get("/notifications/channels", response_model=list[NotificationChannelResponse])
def list_notification_channels(db: Session = Depends(get_db)) -> list[NotificationChannelResponse]:
    return service.list_channels(db)


@router.post("/notifications/channels", response_model=NotificationChannelResponse, status_code=status.HTTP_201_CREATED)
def create_notification_channel(
    payload: NotificationChannelPayload,
    db: Session = Depends(get_db),
) -> NotificationChannelResponse:
    return service.create_channel(db, payload)


@router.patch("/notifications/channels/{channel_id}", response_model=NotificationChannelResponse)
def update_notification_channel(
    channel_id: str,
    payload: NotificationChannelPayload,
    db: Session = Depends(get_db),
) -> NotificationChannelResponse:
    return service.update_channel(db, channel_id, payload)


@router.delete("/notifications/channels/{channel_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_notification_channel(channel_id: str, db: Session = Depends(get_db)) -> None:
    service.delete_channel(db, channel_id)


@router.get("/notifications/channel-groups", response_model=list[NotificationChannelGroupResponse])
def list_notification_channel_groups(db: Session = Depends(get_db)) -> list[NotificationChannelGroupResponse]:
    return service.list_channel_groups(db)


@router.post("/notifications/channel-groups", response_model=NotificationChannelGroupResponse, status_code=status.HTTP_201_CREATED)
def create_notification_channel_group(
    payload: NotificationChannelGroupPayload,
    db: Session = Depends(get_db),
) -> NotificationChannelGroupResponse:
    return service.create_channel_group(db, payload)


@router.patch("/notifications/channel-groups/{group_id}", response_model=NotificationChannelGroupResponse)
def update_notification_channel_group(
    group_id: str,
    payload: NotificationChannelGroupPayload,
    db: Session = Depends(get_db),
) -> NotificationChannelGroupResponse:
    return service.update_channel_group(db, group_id, payload)


@router.delete("/notifications/channel-groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_notification_channel_group(group_id: str, db: Session = Depends(get_db)) -> None:
    service.delete_channel_group(db, group_id)


@router.get("/notifications/contacts", response_model=list[NotificationContactResponse])
def list_notification_contacts(db: Session = Depends(get_db)) -> list[NotificationContactResponse]:
    return service.list_contacts(db)


@router.post("/notifications/contacts", response_model=NotificationContactResponse, status_code=status.HTTP_201_CREATED)
def create_notification_contact(
    payload: NotificationContactPayload,
    db: Session = Depends(get_db),
) -> NotificationContactResponse:
    return service.create_contact(db, payload)


@router.patch("/notifications/contacts/{contact_id}", response_model=NotificationContactResponse)
def update_notification_contact(
    contact_id: str,
    payload: NotificationContactPayload,
    db: Session = Depends(get_db),
) -> NotificationContactResponse:
    return service.update_contact(db, contact_id, payload)


@router.delete("/notifications/contacts/{contact_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_notification_contact(contact_id: str, db: Session = Depends(get_db)) -> None:
    service.delete_contact(db, contact_id)


@router.get("/notifications/contact-groups", response_model=list[NotificationContactGroupResponse])
def list_notification_contact_groups(db: Session = Depends(get_db)) -> list[NotificationContactGroupResponse]:
    return service.list_contact_groups(db)


@router.post("/notifications/contact-groups", response_model=NotificationContactGroupResponse, status_code=status.HTTP_201_CREATED)
def create_notification_contact_group(
    payload: NotificationContactGroupPayload,
    db: Session = Depends(get_db),
) -> NotificationContactGroupResponse:
    return service.create_contact_group(db, payload)


@router.patch("/notifications/contact-groups/{group_id}", response_model=NotificationContactGroupResponse)
def update_notification_contact_group(
    group_id: str,
    payload: NotificationContactGroupPayload,
    db: Session = Depends(get_db),
) -> NotificationContactGroupResponse:
    return service.update_contact_group(db, group_id, payload)


@router.delete("/notifications/contact-groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_notification_contact_group(group_id: str, db: Session = Depends(get_db)) -> None:
    service.delete_contact_group(db, group_id)


@router.get("/notifications/templates", response_model=list[NotificationTemplateResponse])
def list_notification_templates(db: Session = Depends(get_db)) -> list[NotificationTemplateResponse]:
    return service.list_templates(db)


@router.post("/notifications/templates", response_model=NotificationTemplateResponse, status_code=status.HTTP_201_CREATED)
def create_notification_template(
    payload: NotificationTemplatePayload,
    db: Session = Depends(get_db),
) -> NotificationTemplateResponse:
    return service.create_template(db, payload)


@router.patch("/notifications/templates/{template_id}", response_model=NotificationTemplateResponse)
def update_notification_template(
    template_id: str,
    payload: NotificationTemplatePayload,
    db: Session = Depends(get_db),
) -> NotificationTemplateResponse:
    return service.update_template(db, template_id, payload)


@router.delete("/notifications/templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_notification_template(template_id: str, db: Session = Depends(get_db)) -> None:
    service.delete_template(db, template_id)


@router.get("/notifications/rules", response_model=list[NotificationRuleResponse])
def list_notification_rules(db: Session = Depends(get_db)) -> list[NotificationRuleResponse]:
    return service.list_rules(db)


@router.post("/notifications/rules", response_model=NotificationRuleResponse, status_code=status.HTTP_201_CREATED)
def create_notification_rule(
    payload: NotificationRulePayload,
    db: Session = Depends(get_db),
) -> NotificationRuleResponse:
    return service.create_rule(db, payload)


@router.patch("/notifications/rules/{rule_id}", response_model=NotificationRuleResponse)
def update_notification_rule(
    rule_id: str,
    payload: NotificationRulePayload,
    db: Session = Depends(get_db),
) -> NotificationRuleResponse:
    return service.update_rule(db, rule_id, payload)


@router.delete("/notifications/rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_notification_rule(rule_id: str, db: Session = Depends(get_db)) -> None:
    service.delete_rule(db, rule_id)


@router.post("/notifications/test", response_model=NotificationTestResponse)
def test_notification(
    payload: NotificationTestPayload,
    db: Session = Depends(get_db),
) -> NotificationTestResponse:
    return service.send_test_notification(db, payload)


@router.post("/notifications/events", response_model=NotificationTestResponse, status_code=status.HTTP_201_CREATED)
def dispatch_custom_notification_event(
    payload: CustomEventPayload,
    db: Session = Depends(get_db),
) -> NotificationTestResponse:
    return service.dispatch_custom_event(db, payload)


@router.get("/notifications/deliveries", response_model=NotificationDeliveryListResponse)
def list_notification_deliveries(
    instance_id: int | None = Query(default=None),
    source_type: str | None = Query(default=None),
    event_type: str | None = Query(default=None),
    delivery_status: str | None = Query(default=None),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
) -> NotificationDeliveryListResponse:
    return service.list_deliveries(
        db,
        instance_id=instance_id,
        source_type=source_type,
        event_type=event_type,
        delivery_status=delivery_status,
        offset=offset,
        limit=limit,
    )
