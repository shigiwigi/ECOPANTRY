"""Report preview schema: every report is a title, the filters used and tables of strings."""

from datetime import datetime

from pydantic import BaseModel, Field

from app.services.reports import Report


class ReportFilter(BaseModel):
    label: str
    value: str


class ReportSectionOut(BaseModel):
    title: str
    columns: list[str]
    rows: list[list[str]]
    total_rows: int = Field(description="Rows that exist. More than `rows` holds when `truncated`.")
    truncated: bool


class ReportOut(BaseModel):
    kind: str
    title: str
    generated_at: datetime
    filters: list[ReportFilter]
    sections: list[ReportSectionOut]
    notes: list[str]

    @classmethod
    def of(cls, report: Report) -> "ReportOut":
        return cls(
            kind=report.kind,
            title=report.title,
            generated_at=report.generated_at,
            filters=[ReportFilter(label=a, value=b) for a, b in report.filters],
            sections=[
                ReportSectionOut(
                    title=s.title, columns=s.columns, rows=s.rows, total_rows=s.total_rows, truncated=s.truncated
                )
                for s in report.sections
            ],
            notes=report.notes,
        )
