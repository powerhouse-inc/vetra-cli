/**
 * A realistic "What I understood" draft for tests and the visual check:
 * defect handling on a construction site, in German — 4 things × 8 fields,
 * 5 steps, 3 roles, 2 links, a sheet as the source of some fields.
 */
import type {
  DraftField,
  DraftFieldType,
  UnderstoodDraft,
} from "../../../shared/understood-draft.js";

function field(
  id: string,
  name: string,
  type: DraftFieldType,
  sheet: string | null = null,
  options: string[] = [],
): DraftField {
  return {
    id,
    name,
    type,
    options,
    source: sheet ? { materialId: "mat-sheet", sheet, column: name } : null,
  };
}

export function defectDraft(): UnderstoodDraft {
  return {
    version: 1,
    language: "de",
    summary:
      "Mängel auf der Baustelle erfassen, dem richtigen Nachunternehmer zuweisen und nach der Behebung abnehmen.",
    things: [
      {
        id: "t-defect",
        name: "Mangel",
        fields: [
          field("f1", "Titel", "text", "Mängelliste"),
          field("f2", "Beschreibung", "text", "Mängelliste"),
          field("f3", "Foto", "photo"),
          field("f4", "Ort", "place"),
          field("f5", "Gewerk", "choice", "Mängelliste", [
            "Elektro",
            "Sanitär",
            "Trockenbau",
          ]),
          field("f6", "Frist", "date", "Mängelliste"),
          field("f7", "Erledigt", "yes-no"),
          field("f8", "Gemeldet von", "person"),
        ],
      },
      {
        id: "t-site",
        name: "Baustelle",
        fields: [
          field("s1", "Name", "text"),
          field("s2", "Adresse", "place"),
          field("s3", "Bauleitung", "person"),
          field("s4", "Baubeginn", "date"),
          field("s5", "Geplantes Ende", "date"),
          field("s6", "Bauabschnitt", "text"),
          field("s7", "Anzahl Wohnungen", "number"),
          field("s8", "Aktiv", "yes-no"),
        ],
      },
      {
        id: "t-sub",
        name: "Nachunternehmer",
        fields: [
          field("n1", "Firma", "text", "Firmen"),
          field("n2", "Ansprechpartner", "person", "Firmen"),
          field("n3", "Telefon", "text", "Firmen"),
          field("n4", "E-Mail", "text", "Firmen"),
          field("n5", "Gewerk", "choice", "Firmen", ["Elektro", "Sanitär"]),
          field("n6", "Vertragsnummer", "text"),
          field("n7", "Offene Mängel", "number"),
          field("n8", "Gesperrt", "yes-no"),
        ],
      },
      {
        id: "t-check",
        name: "Abnahme",
        fields: [
          field("a1", "Datum", "date"),
          field("a2", "Geprüft von", "person"),
          field("a3", "Ergebnis", "choice", null, ["OK", "Nacharbeit"]),
          field("a4", "Foto danach", "photo"),
          field("a5", "Bemerkung", "text"),
          field("a6", "Unterschrift", "photo"),
          field("a7", "Kosten", "number"),
          field("a8", "Freigegeben", "yes-no"),
        ],
      },
    ],
    roles: [
      { id: "r-lead", name: "Bauleiter" },
      { id: "r-sub", name: "Nachunternehmer" },
      { id: "r-office", name: "Büro" },
    ],
    steps: [
      {
        id: "st1",
        name: "Mangel melden",
        roleId: "r-lead",
        thingId: "t-defect",
      },
      { id: "st2", name: "Zuweisen", roleId: "r-office", thingId: "t-defect" },
      { id: "st3", name: "Beheben", roleId: "r-sub", thingId: "t-defect" },
      { id: "st4", name: "Abnehmen", roleId: "r-lead", thingId: "t-check" },
      { id: "st5", name: "Abrechnen", roleId: "r-office", thingId: null },
    ],
    links: [
      { from: "t-defect", to: "t-site", label: "liegt auf" },
      { from: "t-defect", to: "t-sub", label: "zugewiesen an" },
    ],
    questions: [
      "Wer darf einen Mangel als erledigt markieren?",
      "Gibt es Fristen je Gewerk?",
    ],
    materials: [
      { id: "mat-sheet", name: "maengel.xlsx", kind: "SHEET" },
      { id: "mat-photo", name: "ablauf.jpg", kind: "PICTURE" },
    ],
  };
}
