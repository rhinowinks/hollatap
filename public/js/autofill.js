// Reads a business-card PDF on the user's device and guesses the fields. Nothing is uploaded.
let pdfjs = null;
async function loadPdfJs() {
  if (!pdfjs) {
    pdfjs = await import('/vendor/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.mjs';
  }
  return pdfjs;
}

export async function pdfLines(file) {
  const lib = await loadPdfJs();
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const lines = [];
  for (let p = 1; p <= Math.min(doc.numPages, 2); p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const rows = new Map();
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const y = Math.round(it.transform[5] / 3) * 3;
      const size = Math.abs(it.transform[0]) || Math.abs(it.transform[3]) || 10;
      const row = rows.get(y) || { y, parts: [], size: 0 };
      row.parts.push({ x: it.transform[4], s: it.str });
      row.size = Math.max(row.size, size);
      rows.set(y, row);
    }
    [...rows.values()]
      .sort((a, b) => b.y - a.y)
      .forEach((r) => lines.push({ text: r.parts.sort((a, b) => a.x - b.x).map((p) => p.s).join(' ').replace(/\s+/g, ' ').trim(), size: r.size }));
  }
  return lines.filter((l) => l.text);
}

const TITLE_WORDS = /(manager|director|officer|ceo|cto|cfo|coo|founder|head|lead|engineer|consultant|executive|partner|president|chairman|analyst|specialist|coordinator|associate|supervisor|designer|developer|sales|marketing|administrator|accountant|lawyer|doctor|architect|md)\b/i;

export function guessFields(lines) {
  const out = {};
  const all = lines.map((l) => l.text).join('\n');
  const email = all.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (email) out.email = email[0].toLowerCase();
  const phone = all.match(/(\+?234[\s-]?|0)[789][01]\d[\s-]?\d{3}[\s-]?\d{4}|\+\d[\d\s()-]{7,16}\d/);
  if (phone) out.phone = phone[0].replace(/\s+/g, ' ').trim();
  const web = all.match(/\b((?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|ng|net|org|io|co|xyz|africa|biz|info|tours|com\.ng)(?:\/[^\s]*)?)\b/i);
  if (web && !(out.email && out.email.includes(web[1].toLowerCase()) && !/^(https?:|www\.)/i.test(web[1]))) out.website = web[1];
  else if (out.email && !/gmail|yahoo|hotmail|outlook|icloud/.test(out.email)) out.website = out.email.split('@')[1];
  const addr = lines.find((l) => /\b(street|st\.|road|rd\.|avenue|ave|close|crescent|way|estate|lekki|ikoyi|victoria island|ikeja|abuja|lagos|port harcourt|plot|suite|floor)\b/i.test(l.text) && !/@/.test(l.text));
  if (addr) out.address = addr.text;
  const candidates = lines.filter((l) => !/@|\d{4,}|www\.|https?:/i.test(l.text) && l.text.length <= 60);
  const title = candidates.find((l) => TITLE_WORDS.test(l.text));
  if (title) out.job_title = title.text;
  const nameLine = candidates
    .filter((l) => l !== title && /^[A-Za-zÀ-ÿ'.-]+(\s+[A-Za-zÀ-ÿ'.-]+){1,3}$/.test(l.text) && !TITLE_WORDS.test(l.text))
    .sort((a, b) => b.size - a.size)[0];
  if (nameLine) out.full_name = nameLine.text.replace(/\b\w/g, (c) => c.toUpperCase());
  const company = candidates.find((l) => l !== nameLine && l !== title && l !== addr && /\b(ltd|limited|plc|llc|inc|group|ventures|enterprises|company|services|industries|nigeria|global|consult|bank|logistics|solutions)\b/i.test(l.text));
  if (company) out.company = company.text;
  return out;
}

export async function fillFromPdf(file, form, statusEl) {
  try {
    statusEl.textContent = 'Reading your card…';
    const lines = await pdfLines(file);
    if (!lines.length) {
      statusEl.textContent = "This PDF has no readable text (it may be a scanned image). Please type your details.";
      return;
    }
    const g = guessFields(lines);
    let n = 0;
    for (const [k, v] of Object.entries(g)) {
      const el = form.elements[k];
      if (el && v && !el.readOnly) {
        el.value = v;
        n++;
      }
    }
    statusEl.textContent = n ? `Filled ${n} field${n > 1 ? 's' : ''}. Please check everything before saving.` : "We couldn't find details in this PDF. Please type them.";
    form.dispatchEvent(new Event('input', { bubbles: true }));
  } catch (e) {
    console.error(e);
    statusEl.textContent = "We couldn't read that PDF. Please type your details.";
  }
}
