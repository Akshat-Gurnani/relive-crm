"""Cratio 'All leads' export -> clean rows for the Relive CRM import (staging table import_rows).

Usage: python3 -I local/cratio_transform.py <export.csv> <out.json>
Every decision about how Cratio's columns map is in this file, so a re-export can be re-run the same way.
"""
import json, re, sys
from datetime import datetime, timedelta, timezone
import pandas as pd

IST = timezone(timedelta(hours=5, minutes=30))
BLANK = {"", "--select--", "select", "--none--", "none", "0"}


def clean(v):
    v = " ".join(str(v).split())
    return None if v.lower() in BLANK else v


def text(v):
    """Free text: keep the line breaks agents typed, drop empty lines and Cratio's blanks."""
    lines = [" ".join(l.split()) for l in str(v).replace("\r", "\n").split("\n")]
    v = "\n".join(l for l in lines if l)
    return None if v.lower() in BLANK else v


def ts(v, fmt="%d-%b-%y %H:%M:%S"):
    v = clean(v)
    if not v:
        return None
    for f in (fmt, "%d-%b-%y"):
        try:
            return datetime.strptime(v, f).replace(tzinfo=IST).isoformat()
        except ValueError:
            pass
    return None


def secs(v):
    m = re.fullmatch(r"(\d+):(\d+):(\d+)", str(v).strip())
    return int(m[1]) * 3600 + int(m[2]) * 60 + int(m[3]) if m else 0


# ---------------------------------------------------------------- staff (display names)
STAFF = {
    "AKSHAT": "Akshat Gurnani", "SYSTEMBOT": None,
}
ADMINS = {"AKSHAT", "VARSHA GURNANI", "AMIT GURNANI", "PANKAJ GURNANI"}


def staff(v):
    v = clean(v)
    if not v:
        return None
    k = v.upper()
    if k in STAFF:
        return STAFF[k]
    return " ".join(w.capitalize() for w in v.split())


# ---------------------------------------------------------------- projects, campaigns, interest tags
PROJECT_FIX = {
    "MIGSUN": "Migsun", "SAHU PEARL": "Sahu City Pearl", "SAHU CITY PEARL": "Sahu City Pearl",
    "SKYOM": "Sky OM", "SKY OM": "Sky OM", "EIFFLE PALM VISTA": "Eiffel Palm Vista",
    "OKAS": "Okas Plots", "OKAS PLOTS": "Okas Plots", "LALA JUGAL KISHORE": "LJK", "LJK": "LJK",
    "GH PINTAIL": "Pintail", "PINTAIL": "Pintail", "CPA HNI": "Centre Point Ayodhya",
    "CPD HNI": "Centre Point Ayodhya", "EMAAR ELITE": "Emaar Elite Oasis",
    "PURVANCHAL ATLANTIS": "Purvanchal Royal Atlantis", "EKANA EBC": "Ekana EBC", "SMJ VILLA": "SMJ Villa",
    "DPS PALLADIO": "DPS Palladio", "SHALIMAR KSMB": "Shalimar KSMB", "M3M": "M3M", "JBBR": "JBBR",
    "DLF MY PAD": "DLF My Pad", "VR HNI": None, "MAX HNI": None, "CAROUSEL HNI": None,
    "EXCELLA 65 ACRE": "Excella 65 Acre", "EDEN 1": "Eden 1", "SUMMIT 2": "Summit 2",
}
CAMPAIGN = {"LPM 75 LAC": "LPM 75 LAC", "LMP 75 LAC": "LPM 75 LAC", "LPM": "LPM 75 LAC"}
INTEREST = {"RESIDENTIAL": "Residential", "COMMERCIAL": "Commercial", "PLOT ENQUIRY": "Plot",
            "INVESTMENT": "Investment", "RESIDENTIAL 1.8 CR": "Residential", "RESIDENTIAL 95 LACS": "Residential"}
TAG = {"ASSOCIATE": "Associate", "RAW DATA": "Raw data", "YTT": "YTT"}
HNI = {"CPA HNI", "CPD HNI", "VR HNI", "MAX HNI", "CAROUSEL HNI"}


def products(v):
    projects, campaigns, interests, tags = [], [], [], []
    for t in str(v).split(","):
        t = " ".join(t.strip().upper().split())
        if not t:
            continue
        if t in HNI:
            tags.append("HNI")
        if t in CAMPAIGN:
            campaigns.append(CAMPAIGN[t])
        elif t in INTEREST:
            interests.append(INTEREST[t])
        elif t in TAG:
            tags.append(TAG[t])
        else:
            name = PROJECT_FIX.get(t, " ".join(w.capitalize() for w in t.split())) if t in PROJECT_FIX or t not in HNI else None
            if name:
                projects.append(name)
    u = lambda xs: list(dict.fromkeys(xs))
    return u(projects), u(campaigns), u(interests), u(tags)


# ---------------------------------------------------------------- lead sources
# Kept exactly as Relive marks them in Cratio (DFBL, RELIVE SELF, LPM 2.0 EVENT...). Spellings that differ only
# in case (Direct Lead / DIRECT LEAD) are merged under the one used most; CANON is filled in main().
CANON: dict = {}
META = {"DFBL", "SFBL", "AFBL", "BTFBL", "HFBL", "ADFBL", "FACEBOOK CAMPAIGN", "RELIVE FACEBOOK", "CITY KONNECT FB", "FBL T20"}


def source(v):
    """-> (source, vendor, provider, campaign)"""
    k = " ".join(str(v).upper().split())
    provider = "meta" if k in META else "google_ads" if k == "GOOGLE LEADS" else "website" if k == "WEBSITE" else None
    return CANON.get(k) or "Other", None, provider, None


# ---------------------------------------------------------------- stage, temperature, lost reason
LOST = {"customer not interested": "Not interested", "wrong client segment": "Wrong client segment",
        "wrong info": "Wrong info", "pricing issue": "Pricing issue", "lost to competition": "Bought elsewhere",
        "other": "Other"}


def stage(r):
    s = (clean(r["Lead Stage"]) or "").lower()
    temp = s if s in ("hot", "warm", "cold") else ("cold" if s == "lost" else "hot" if s == "converted" else "warm")
    if s == "lost":
        st = "Lost"
    elif s == "converted":
        st = "Booked"
    elif clean(r["Visit Done Date"]):
        st = "Site Visit Done"
    elif clean(r["Site Visit Scheduled"]):
        st = "Site Visit Scheduled"
    elif s == "yet to talk":
        st = "Yet To Talk"
    elif s in ("new", ""):
        st = "New"
    else:
        st = "Follow-up"  # Followup, Hot, Warm, Cold: Cratio uses temperature as a stage
    return st, temp


CITY = {"Lko": "Lucknow", "Lucknow Up": "Lucknow", "Lucknow, Up": "Lucknow"}


def row(i, r):
    phone = re.sub(r"\D", "", r["Mobile Number"])[-10:]
    alt = re.sub(r"\D", "", r["Alternate Contact"])
    projects, campaigns, interests, tags = products(r["Product Category"])
    src, vendor, provider, src_campaign = source(r["Lead Source"])
    st, temp = stage(r)
    lost = st == "Lost"
    city = clean(r["City"])
    city = CITY.get(city.title(), city.title()) if city else None
    email = clean(r["Email"])
    if email and email.lower() == "relivesales@gmail.com":
        email = None  # company placeholder, not the customer's
    size, bhk = clean(r["Size"]), clean(r["Category"])
    if size and "BHK" in size.upper():
        bhk, size = bhk or size, None
    created = ts(r["Created Time"])
    last_call = ts(r["Last Call Time"])
    updated = ts(r["Updated Time"])
    # Cratio puts Facebook form answers into whatever spare column was mapped; keep them under their Cratio names
    spill = {k: clean(r[k]) for k in ("Company Name", "Designation", "Role") if clean(r[k])}
    if clean(r["Alternate Contact"]) and len(alt) < 10:
        spill["Alternate Contact"] = clean(r["Alternate Contact"])
    dur = secs(r["Call Duration"])
    return {
        "n": i,
        "phone": phone,
        "name": clean(r["Customer Name"]),
        "email": email,
        "alt_phone": alt[-10:] if len(alt) >= 10 else None,
        "city": city,
        "street": ", ".join(x for x in (clean(r["Street1"]), clean(r["Street2"])) if x) or None,
        "state": clean(r["State"]),
        "pincode": clean(r["Pincode"]),
        "country": (clean(r["Country"]) or "").title() or None,
        "birthday": (ts(r["BIRTHDAY DATE"]) or "")[:10] or None,
        "spouse_birthday": (ts(r["SPOUSE BIRTHDAY"]) or "")[:10] or None,
        "project": projects[0] if projects else None,
        "interests": list(dict.fromkeys(projects[1:] + interests)),
        "tags": tags,
        "source": src,
        "vendor": vendor,
        "provider": provider,
        "campaign": (campaigns[0] if campaigns else None) or src_campaign,
        "stage": st,
        "temperature": temp,
        "priority": (clean(r["Lead Priority"]) or "Medium").capitalize(),
        "lead_type": {"META": "Meta", "WEBSITE TRAFFIC": "Website traffic"}.get((clean(r["LEAD TYPE"]) or "").upper()),
        "qualification": {"QUALIFIED LEAD": "Qualified", "NON-QUALIFIED LEAD": "Non-qualified",
                          "DIVERTED LEAD": "Diverted"}.get((clean(r["LEADSTATUS"]) or "").upper()),
        "budget_band": clean(r["Budget"]),
        "property_type": clean(r["Type"]),
        "bhk": bhk,
        "unit_size": size,
        "location_pref": clean(r["Location"]),
        "possession_pref": clean(r["Possession"]),
        "description": text(r["Description"]),
        "lost_reason": (LOST.get((clean(r["Lost Reason"]) or "").lower(), "Other") if lost else None),
        "lost_remarks": text(r["Lost Remarks"]) if lost else None,
        "lost_at": ts(r["Lost Date"]) if lost else None,  # Cratio fills Lost Date on most open leads too: ignored there
        "converted_at": ts(r["Converted Date"]) if st == "Booked" else None,
        "assigned_to": staff(r["Assigned To"]),
        "assigned_at": ts(r["Lead Assigned At"]),
        "first_contacted_at": ts(r["First Touch At"]) or last_call,
        "next_followup_at": ts(r["Next Follow-up On"]) if st not in ("Lost", "Booked") else None,
        "visit_scheduled": ts(r["Site Visit Scheduled"]),
        "visit_done": ts(r["Visit Done Date"]),
        "call": ({"agent": staff(r["Caller Name"]) or staff(r["Assigned To"]), "at": last_call, "seconds": dur,
                  "connected": r["Feedback"] == "Connected" or dur > 0} if last_call else None),
        "created_at": created,
        "created_by": staff(r["Created Username"]),
        "updated_at": updated,
        "updated_by": staff(r["Updated Username"]),
        "last_activity_at": max(x for x in (created, updated, last_call) if x),
        "legacy": {k: v for k, v in {
            "Lead Source": clean(r["Lead Source"]), "Lead Stage": clean(r["Lead Stage"]),
            "Product Category": clean(r["Product Category"]), "Lead Date": clean(r["Lead Date"]),
            "Call did Status": clean(r["Call did Status"]), "Lead Visit Status": clean(r["Lead Visit Status"]),
            "Viewed by": clean(r["Viewed Username"]), "Owner in Cratio": staff(r["Assigned To"]),
            "Created by": staff(r["Created Username"]), "Last updated by": staff(r["Updated Username"]), **spill}.items() if v},
    }


def main(src, out):
    df = pd.read_csv(src, dtype=str, keep_default_na=False)
    spell = df["Lead Source"].map(lambda v: " ".join(str(v).split())).loc[lambda x: x != ""]
    for v, _ in spell.value_counts().items():
        CANON.setdefault(v.upper(), v)
    rows = [row(i + 1, r) for i, r in df.iterrows()]
    names = {}
    for c in ("Assigned To", "Caller Name", "Created Username", "Updated Username", "Viewed Username"):
        for v in df[c]:
            n = staff(v)
            if n:
                names.setdefault(n, {"name": n, "admin": clean(v).upper() in ADMINS, "leads": 0, "recent": None})
    for r, (_, raw) in zip(rows, df.iterrows()):
        if r["assigned_to"]:
            names[r["assigned_to"]]["leads"] += 1
    json.dump({"rows": rows, "staff": sorted(names.values(), key=lambda s: -s["leads"])}, open(out, "w"), ensure_ascii=False)
    print(len(rows), "rows,", len(names), "staff")


if __name__ == "__main__":
    main(*sys.argv[1:3])
