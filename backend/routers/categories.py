from fastapi import APIRouter, Depends
from pydantic import BaseModel

from core.security import get_current_user
from services import notes

router = APIRouter(prefix="/api/categories", tags=["categories"])


class CategoryRename(BaseModel):
    new_name: str


@router.get("")
def get_categories(current_user: str = Depends(get_current_user)):
    return notes.get_categories(user_id=current_user)


@router.post("")
def update_categories(categories: list[dict], current_user: str = Depends(get_current_user)):
    notes.save_categories(categories, user_id=current_user)
    return {"message": "Success"}


@router.put("/{old_name}")
def rename_category(
    old_name: str, data: CategoryRename, current_user: str = Depends(get_current_user)
):
    notes.rename_category(old_name, data.new_name, user_id=current_user)
    return {"message": "Success"}


@router.delete("/{name}")
def delete_category(name: str, current_user: str = Depends(get_current_user)):
    notes.delete_category(name, user_id=current_user)
    return {"message": "Success"}
