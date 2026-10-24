from pydantic import BaseModel, Field, ConfigDict, model_validator


class TopicPreference(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    category_id: str = Field(min_length=1, max_length=80)
    reduce: bool


class CategoryEdit(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    name: str | None = Field(default=None, min_length=1, max_length=80)
    parent_id: str | None = Field(default=None, min_length=1, max_length=80)
    move: bool = False
    merge_into: str | None = Field(default=None, min_length=1, max_length=80)

    @model_validator(mode="after")
    def one_operation(self):
        if sum((self.name is not None, self.move, self.merge_into is not None)) != 1:
            raise ValueError("Choose one rename, move, or merge operation")
        if self.name is not None and (not self.name.strip() or any(ord(c) < 32 for c in self.name)):
            raise ValueError("Category name must be readable")
        if self.name is not None:
            self.name = self.name.strip()
        return self


