"""Render a `Report` (app/services/reports.py) as CSV or PDF bytes.

CSV: UTF-8 with a byte-order mark so Excel reads accents correctly. Cells that
could run as a formula in a spreadsheet (starting with = + - @, tab or CR, and
not a plain number) get a leading apostrophe.

PDF: ReportLab, plain A4, no images or fonts to bundle: title, generated time
(UTC), filters, notes, tables, page numbers and the prototype disclaimer.
"""

import csv
import io
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.services.reports import DISCLAIMER, Report

CSV_BOM = "﻿"
_FORMULA_STARTS = ("=", "+", "-", "@", "\t", "\r")


def safe_cell(value: str) -> str:
    """Neutralise spreadsheet formulas. Plain numbers such as -3.5 are left alone."""
    if not value.startswith(_FORMULA_STARTS):
        return value
    try:
        float(value)
    except ValueError:
        return "'" + value
    return value


def generated_text(report: Report) -> str:
    return report.generated_at.strftime("%Y-%m-%d %H:%M UTC")


def to_csv(report: Report) -> bytes:
    out = io.StringIO(newline="")
    writer = csv.writer(out, lineterminator="\r\n")
    writer.writerow([report.title])
    writer.writerow(["Generated", generated_text(report)])
    for label, value in report.filters:
        writer.writerow([label, safe_cell(value)])
    for note in report.notes:
        writer.writerow(["Note", safe_cell(note)])
    writer.writerow(["Note", DISCLAIMER])
    for section in report.sections:
        writer.writerow([])
        writer.writerow([safe_cell(section.title)])
        writer.writerow([safe_cell(c) for c in section.columns])
        for row in section.rows:
            writer.writerow([safe_cell(cell) for cell in row])
    return (CSV_BOM + out.getvalue()).encode("utf-8")


def to_pdf(report: Report) -> bytes:
    buffer = io.BytesIO()
    styles = getSampleStyleSheet()
    body = ParagraphStyle("body", parent=styles["BodyText"], fontSize=9, leading=12)
    cell = ParagraphStyle("cell", parent=body, fontSize=8, leading=10)
    head = ParagraphStyle("head", parent=cell, fontName="Helvetica-Bold", textColor=colors.white)

    def footer(canvas: Canvas, doc: SimpleDocTemplate) -> None:
        canvas.saveState()
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(colors.HexColor("#555555"))
        canvas.drawString(15 * mm, 10 * mm, DISCLAIMER)
        canvas.drawRightString(A4[0] - 15 * mm, 10 * mm, f"Page {doc.page}")
        canvas.restoreState()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=15 * mm,
        rightMargin=15 * mm,
        topMargin=15 * mm,
        bottomMargin=18 * mm,
        title=f"EcoPantry {report.title}",
        author="EcoPantry",
    )
    width = A4[0] - 30 * mm
    story: list[object] = [
        Paragraph(escape(f"EcoPantry - {report.title}"), styles["Title"]),
        Paragraph(f"Generated: {escape(generated_text(report))}", body),
    ]
    for label, value in report.filters:
        story.append(Paragraph(f"{escape(label)}: {escape(value)}", body))
    for note in report.notes:
        story.append(Paragraph(escape(note), body))
    for section in report.sections:
        story.append(Spacer(1, 6 * mm))
        story.append(Paragraph(escape(section.title), styles["Heading3"]))
        if not section.rows:
            story.append(Paragraph("No rows.", body))
            continue
        data = [[Paragraph(escape(c), head) for c in section.columns]]
        data += [[Paragraph(escape(v), cell) for v in row] for row in section.rows]
        table = Table(data, colWidths=[width / len(section.columns)] * len(section.columns), repeatRows=1)
        table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#215F47")),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F3F0E6")]),
                    ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#BBBBBB")),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 3),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 3),
                ]
            )
        )
        story.append(table)
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()
