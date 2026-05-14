require("dotenv").config();
const express = require("express");
const multer = require("multer");
const { google } = require("googleapis");
const path = require("path");
const stream = require("stream");

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
app.use(express.json());
app.use(express.static(__dirname));

// ─── Google Auth (Using Environment Variable for Cloud) ──────────────────────
// On Railway, paste the contents of credentials.json into a variable named GOOGLE_CREDENTIALS
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
  ],
});

const SHEET_ID = "1cU8udmbmlRgf-OB1p3XvJdMKdCIuzNmiX0X_S3VYrqU";
const FOLDER_ID = "1AFXQeIq_yPnuwJSWqirVk2CBGadwfgyjQy3S0tOHYe3tFiIzno7dq2ropqypT2NcxPpm4Ham";
const FORM_ID = "1FAIpQLSeHcDghB3SmK0bLmrA1fvlaetXIVnxbYYPnF7Zzxv3Rrtt0pg";
const SHEET_TAB = "Sheet1";

const FORM_ENTRIES = {
  name: "entry.225862882",
  company: "entry.776618226",
  position: "entry.1851580118",
  phone: "entry.67347306",
  altPhone: "entry.736656530",
  email: "entry.63571399",
  website: "entry.1750607689",
  address: "entry.1991856585",
  industry: "entry.1505797340",
  voltage: "entry.383872389",
  harmonics: "entry.1443195320",
  pfIssue: "entry.1413035194",
  gridStability: "entry.200033880",
  highElecBill: "entry.1968487711",
  projectTimeline: "entry.1617565468",
  qualification: "entry.831142340",
  projectSize: "entry.1173537247",
  immediateReq: "entry.1842668825",
  engineerName: "entry.1467437943",
};

// ─── Helper: Get Next Lead Number from Sheet (Railway-safe) ──────────────────
async function getNextLeadNumber(sheets) {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_TAB}!A:A`,
    });
    const rows = response.data.values;
    if (!rows || rows.length <= 1) return 1;
    
    // Assumes first column is "LEAD-0001" format
    const lastLeadStr = rows[rows.length - 1][0];
    const lastNum = parseInt(lastLeadStr.split("-")[1]);
    return isNaN(lastNum) ? rows.length : lastNum + 1;
  } catch (err) {
    console.error("Error fetching lead number:", err);
    return Date.now(); // Fallback to timestamp if sheet fetch fails
  }
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// ─── Route: Parse business card with Gemini ────────────────────────────────────
app.post("/parse-card", upload.single("card"), async (req, res) => {
  try {
    const imageBase64 = req.file.buffer.toString("base64");
    const mimeType = req.file.mimetype;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inlineData: { mimeType, data: imageBase64 } },
              { text: `Extract all contact information from this business card image. Return ONLY a valid JSON object with exactly these keys: "name", "company", "position", "phone", "altPhone", "email", "website", "address". No explanation. No markdown.` }
            ]
          }]
        }),
      }
    );

    const geminiData = await geminiRes.json();
    if (geminiData.error) throw new Error(geminiData.error.message);

    const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    const clean = rawText.replace(/```json|```/gi, "").trim();
    res.json({ success: true, data: JSON.parse(clean) });
  } catch (err) {
    console.log(`⚠️ Gemini Error: ${err.message}`);
    res.json({ success: false, error: err.message });
  }
});

// ─── Route: Submit lead (Cloud Upload to Drive) ──────────────────────────────
app.post("/submit", upload.single("card"), async (req, res) => {
  try {
    const fields = JSON.parse(req.body.fields);
    const authClient = await auth.getClient();
    const drive = google.drive({ version: "v3", auth: authClient });
    const sheets = google.sheets({ version: "v4", auth: authClient });

    // 1. Determine Lead Number from Sheets
    const leadNum = await getNextLeadNumber(sheets);
    const leadRef = `LEAD-${String(leadNum).padStart(4, "0")}`;
    const fileName = `${leadRef}.jpg`;

    // 2. Upload to Google Drive (Cloud-safe, no local disk)
    if (req.file) {
      const bufferStream = new stream.PassThrough();
      bufferStream.end(req.file.buffer);

      await drive.files.create({
        requestBody: {
          name: fileName,
          parents: [FOLDER_ID],
        },
        media: {
          mimeType: req.file.mimetype,
          body: bufferStream,
        },
      });
    }

    // 3. Append to Google Sheet
    const now = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    const row = [
      leadRef, now, fields.engineerName || "", fields.name || "",
      fields.company || "", fields.position || "", fields.phone || "",
      fields.altPhone || "", fields.email || "", fields.website || "",
      fields.address || "", fields.industry || "", (fields.voltage || []).join(", "),
      fields.harmonics || "", fields.pfIssue || "", fields.gridStability || "",
      fields.highElecBill || "", fields.projectTimeline || "",
      fields.qualification || "", fields.projectSize || "", fields.immediateReq || ""
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_TAB}!A1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [row] },
    });

    console.log(`✅ ${leadRef} submitted successfully`);
    res.json({ success: true, leadRef });
  } catch (err) {
    console.error("Submit error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server live on port ${PORT}`);
});