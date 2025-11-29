// js/ics-parser.js
// Module: robust ICS parser (server-side).
// Exports: parseW2W(text) và parseW2WFileSync(path).
// Mục tiêu: trả về mảng events với tất cả các trường dữ liệu.

const fs = require('fs');

/* ---------- Public API ---------- */
function parseW2W(text) {
  if (typeof text !== 'string') return [];

  // 1) Unfold folded lines per RFC5545:
  //    các dòng bị "gập" tiếp theo sẽ bắt đầu bằng khoảng trắng hoặc tab
  //    nên ghép lại vào dòng trước (xóa CRLF + space/tab)
  const unfolded = text.replace(/\r\n[ \t]/g, '');
  // split lines
  const lines = unfolded.split(/\r?\n/);

  // 2) group into VEVENT blocks (giữ nguyên order)
  const blocks = [];
  let currentLines = null;
  for (const raw of lines) {
    if (/^BEGIN:VEVENT$/i.test(raw)) {
      currentLines = [];
      continue; // skip the BEGIN line itself
    }
    if (/^END:VEVENT$/i.test(raw)) {
      if (currentLines) {
        blocks.push(currentLines.join('\n'));
        currentLines = null;
      }
      continue;
    }
    if (currentLines) currentLines.push(raw);
  }

  // 3) parse each block into an object
  const events = blocks.map(block => parseEventBlock(block));

  return events;
}

function parseW2WFileSync(filePath, encoding = 'utf8') {
  const raw = fs.readFileSync(filePath, encoding);
  return parseW2W(raw);
}

/* ---------- Helpers ---------- */

// Parse a single VEVENT block (string)
function parseEventBlock(block) {
  // Thêm _allProperties để lưu trữ tất cả các trường theo thứ tự và dễ lặp
  const ev = {
    _rawBlock: block,
    _parsed: {},
    _allProperties: [] // Mảng mới để chứa {name, value, params} cho tất cả các trường
  };

  // split into lines and process each line
  const lines = block.split(/\r?\n/);

  for (const rawLine of lines) {
    if (!rawLine) continue;

    // split at first ':' (value can contain colons)
    const m = rawLine.match(/^([^:]+):([\s\S]*)$/);
    if (!m) continue;

    const keyPart = m[1]; // e.g., "DTSTART;TZID=America/Los_Angeles"
    const rawValue = m[2];

    // split keyPart into name and params
    const [nameRaw, ...paramParts] = keyPart.split(';');
    const name = nameRaw.toUpperCase();

    // parse params into object
    const params = {};
    for (const p of paramParts) {
      const kv = p.split('=');
      if (kv.length === 1) params[kv[0].toUpperCase()] = true;
      else params[kv[0].toUpperCase()] = kv.slice(1).join('=');
    }

    // TEXT properties need unescape
    const textProps = new Set(['DESCRIPTION', 'SUMMARY', 'LOCATION', 'COMMENT', 'CATEGORIES', 'ORGANIZER', 'ATTENDEE']);
    let value = rawValue;
    if (textProps.has(name)) value = unescapeICSText(value);

    // Store: support repeated keys -> array (cho các trường chính)
    if (ev.hasOwnProperty(name)) {
      if (!Array.isArray(ev[name])) ev[name] = [ev[name]];
      ev[name].push(value);
    } else {
      ev[name] = value;
    }

    // LƯU TRỮ VÀO MẢNG CHUNG ĐỂ LẶP (Chìa khóa để hiển thị tất cả các trường)
    ev._allProperties.push({
      name: name,
      value: value,
      params: Object.keys(params).length ? params : null
    });

    // parse date/time for DTSTART/DTEND
    if (name === 'DTSTART' || name === 'DTEND') {
      ev._parsed[name] = parseW2WDatetime(rawValue, params);
    }

    // LƯU Ý: Đã bỏ ev._params, thay thế bằng _allProperties
  }

  // Heuristic fallback: nếu thiếu DTSTART/DTEND, thử extract từ SUMMARY/DESCRIPTION
  if ((!ev._parsed.DTSTART || ev._parsed.DTSTART.type === 'unknown') &&
    (!ev._parsed.DTEND || ev._parsed.DTEND.type === 'unknown')) {
    // prefer DESCRIPTION then SUMMARY
    const textForHeuristic = (ev.DESCRIPTION || ev.SUMMARY || '').toString();
    const heuristic = tryExtractDateTimeFromText(textForHeuristic);
    if (heuristic) {
      if (heuristic.start) ev._parsed.DTSTART = heuristic.start;
      if (heuristic.end) ev._parsed.DTEND = heuristic.end;
      // also store readable fallback fields so EJS can show them
      if (heuristic.readableStart) ev._fallbackStart = heuristic.readableStart;
      if (heuristic.readableEnd) ev._fallbackEnd = heuristic.readableEnd;
    }
  }

  // 4) LOGIC MỚI: Định dạng ngày bắt đầu và kết thúc để hiển thị (tạo ra _displayStart và _displayEnd)
  const displayOptions = {
    // Sử dụng locale Việt Nam để định dạng
    locale: 'vi-VN',
    // Múi giờ mặc định cho hiển thị (có thể thay đổi nếu cần)
    timeZone: 'Asia/Ho_Chi_Minh',
    dateStyle: 'short',
    timeStyle: 'short'
  };

  const startObj = ev._parsed.DTSTART;
  if (startObj) {
    if (startObj.type === 'datetime' && startObj.date instanceof Date) {
      // Định dạng cho datetime objects
      ev._displayStart = startObj.date.toLocaleString(displayOptions.locale, { timeZone: displayOptions.timeZone, dateStyle: displayOptions.dateStyle, timeStyle: displayOptions.timeStyle });
    } else if (startObj.type === 'date') {
      // Cho sự kiện chỉ có ngày (date-only)
      ev._displayStart = startObj.isoDate || startObj.original;
    }
  } else if (ev._fallbackStart) {
    // Sử dụng heuristic fallback nếu DTSTART chính thức bị thiếu
    ev._displayStart = ev._fallbackStart;
  }

  const endObj = ev._parsed.DTEND;
  if (endObj) {
    if (endObj.type === 'datetime' && endObj.date instanceof Date) {
      ev._displayEnd = endObj.date.toLocaleString(displayOptions.locale, { timeZone: displayOptions.timeZone, dateStyle: displayOptions.dateStyle, timeStyle: displayOptions.timeStyle });
    } else if (endObj.type === 'date') {
      ev._displayEnd = endObj.isoDate || endObj.original;
    }
  } else if (ev._fallbackEnd) {
    // Sử dụng heuristic fallback nếu DTEND chính thức bị thiếu
    ev._displayEnd = ev._fallbackEnd;
  }

  // If parsed DTSTART exists but no DTEND, and DTSTART is datetime (not date-only), try to infer end from duration in summary (rare).
  // For safety, we won't auto-guess end if not present (unless heuristic found a range).

  return ev;
}

// parse common ICS datetime formats into object {type, date, isoDate, original, tzid}
// supports YYYYMMDD (date-only), YYYYMMDDTHHMMSSZ (UTC), YYYYMMDDTHHMMSS (local), YYYYMMDDTHHMM (local)
function parseW2WDatetime(value, params = {}) {
  const original = value;
  if (!value) return { type: 'unknown', original };

  // Remove surrounding whitespace
  const v = String(value).trim();

  // date-only: YYYYMMDD
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/;
  const dtUTC = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;         // UTC
  const dtLocalFull = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/;    // local with seconds
  const dtLocalShort = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})$/;          // local without seconds

  // If params indicate VALUE=DATE, treat as date-only
  if ((params.VALUE && String(params.VALUE).toUpperCase() === 'DATE') || dateOnly.test(v)) {
    const m = v.match(dateOnly);
    if (!m) return { type: 'date', isoDate: v, original };
    // For date-only, we store it as an ISO date string (YYYY-MM-DD)
    return { type: 'date', isoDate: `${m[1]}-${m[2]}-${m[3]}`, original };
  }

  let m;
  if ((m = v.match(dtUTC))) {
    const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
    const d = new Date(iso);
    return { type: 'datetime', date: d, original, tzid: params.TZID || null };
  }
  if ((m = v.match(dtLocalFull))) {
    // Khi parse date local (không có Z/TZID), new Date() sẽ tạo đối tượng theo múi giờ local của server/runtime
    const year = +m[1], month = +m[2] - 1, day = +m[3];
    const hr = +m[4], min = +m[5], sec = +m[6];
    const d = new Date(year, month, day, hr, min, sec);
    return { type: 'datetime', date: d, original, tzid: params.TZID || null };
  }
  if ((m = v.match(dtLocalShort))) {
    const year = +m[1], month = +m[2] - 1, day = +m[3];
    const hr = +m[4], min = +m[5];
    const d = new Date(year, month, day, hr, min, 0);
    return { type: 'datetime', date: d, original, tzid: params.TZID || null };
  }

  // fallback: unknown format
  return { type: 'unknown', original: value };
}

// Unescape ICS text sequences: \n, \N, \, , \; , \\
function unescapeICSText(s) {
  if (s == null) return s;
  return String(s)
    .replace(/\\n/g, '\n')
    .replace(/\\N/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

/* ---------- Heuristic fallback: try extract date/time from free text ----------
   (Giữ nguyên hàm này)
*/
function tryExtractDateTimeFromText(text) {
  if (!text) return null;
  const t = text.toString();

  // normalize spaces
  const norm = t.replace(/\s+/g, ' ');

  // date regex: match "Nov 20, 2025" or "November 20 2025" or "2025-11-20"
  const monthNames = '(Jan|January|Feb|February|Mar|March|Apr|April|May|Jun|June|Jul|July|Aug|August|Sep|September|Sept|Oct|October|Nov|November|Dec|December)';
  const dateRegex1 = new RegExp(`${monthNames}\\s+([0-9]{1,2})(?:,?\\s*([0-9]{4}))?`, 'i'); // e.g., Nov 20, 2025
  const dateRegex2 = /([0-9]{4})-([0-9]{2})-([0-9]{2})/; // 2025-11-20

  // time range regex: "11am-1:45pm", "11:00 AM - 1:45 PM", "11-13:45"
  const timeRangeRegex = /(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)[\s\-–—to]{1,4}(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i;
  // also hourly like "11am to 1:45pm"
  const timeRangeRegex2 = /(\d{1,2}(?::\d{2})?)\s*(am|pm)?\s*(?:-|to|–|—)\s*(\d{1,2}(?::\d{2})?)\s*(am|pm)?/i;

  // find date
  let dateMatch = norm.match(dateRegex1);
  let year = null, month = null, day = null;
  if (dateMatch) {
    // month name -> month number
    const monStr = dateMatch[1];
    const monMap = {
      Jan:1, January:1, Feb:2, February:2, Mar:3, March:3, Apr:4, April:4,
      May:5, Jun:6, June:6, Jul:7, July:7, Aug:8, August:8, Sep:9, Sept:9, September:9,
      Oct:10, October:10, Nov:11, November:11, Dec:12, December:12
    };
    month = monMap[monStr] || monMap[monStr.slice(0,3)];
    day = parseInt(dateMatch[2], 10);
    year = dateMatch[3] ? parseInt(dateMatch[3], 10) : (new Date()).getFullYear();
  } else {
    const m2 = norm.match(dateRegex2);
    if (m2) {
      year = parseInt(m2[1], 10);
      month = parseInt(m2[2], 10);
      day = parseInt(m2[3], 10);
    }
  }

  // find time range
  let tr = norm.match(timeRangeRegex) || norm.match(timeRangeRegex2);

  if (!tr) {
    // no time range found — fallback: maybe a single time in summary like "11am"
    const singleTime = norm.match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
    if (singleTime) {
      tr = [null, singleTime[1], null]; // start only
    }
  }

  if (!dateMatch && !tr) return null; // nothing useful

  // Build readable strings and parsed Date objects if we have at least a date
  let readableStart = null, readableEnd = null;
  let parsedStart = null, parsedEnd = null;

  // If we have explicit date parts, combine with times; otherwise, if only times, we cannot reliably create a date (skip)
  if (year && month && day && tr) {
    // helper to parse a time token like "11am" or "1:45pm" or "13:30"
    const parseTimeToken = (token) => {
      if (!token) return null;
      const tkn = token.trim().toLowerCase();
      // ensure there's a space before am/pm for Date parsing if needed
      const withSpace = tkn.replace(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/i, '$1:$2 $3').replace(/:\s/, ':');
      // try parse hh:mm am/pm
      const ampm = withSpace.match(/(am|pm)$/i);
      let hh = 0, mm = 0;
      const mmMatch = withSpace.match(/(\d{1,2}):(\d{2})/);
      if (mmMatch) { hh = parseInt(mmMatch[1],10); mm = parseInt(mmMatch[2],10); }
      else {
        const hhMatch = withSpace.match(/(\d{1,2})/);
        if (hhMatch) hh = parseInt(hhMatch[1],10);
      }
      if (ampm) {
        const ap = ampm[1].toLowerCase();
        if (ap === 'pm' && hh < 12) hh += 12;
        if (ap === 'am' && hh === 12) hh = 0;
      }
      return { hh, mm };
    };

    const startToken = tr[1];
    const endToken = tr[2] || null;

    const sT = parseTimeToken(startToken);
    if (sT) {
      parsedStart = new Date(year, (month-1), day, sT.hh, sT.mm, 0);
      readableStart = parsedStart.toLocaleString(
        'vi-VN',
        {
          dateStyle: 'short',
          timeStyle: 'short',
          timeZone: 'Asia/Ho_Chi_Minh'
        }
      );
    }
    if (endToken) {
      const eT = parseTimeToken(endToken);
      if (eT) {
        parsedEnd = new Date(year, (month-1), day, eT.hh, eT.mm, 0);
        readableEnd = parsedEnd.toLocaleString(
          'vi-VN',
          {
            dateStyle: 'short',
            timeStyle: 'short',
            timeZone: 'Asia/Ho_Chi_Minh'
          }
        );
      }
    }
    // If we found start but not end, we can leave end null
  } else if (year && month && day && !tr) {
    // date-only event (no time)
    const parsed = new Date(year, (month-1), day);
    parsedStart = parsed;
    readableStart = parsed.toLocaleDateString('vi-VN');
  }

  const result = { start: parsedStart ? { type: 'datetime', date: parsedStart } : null,
          end: parsedEnd ? { type: 'datetime', date: parsedEnd } : null };

  if (readableStart) result.readableStart = readableStart;
  if (readableEnd) result.readableEnd = readableEnd;

  // also return start/end objects in shape similar to parseW2WDatetime for consistency
  if (result.start) result.start.original = result.start.date.toISOString();
  if (result.end) result.end.original = result.end.date.toISOString();

  return (result.start || result.end) ? result : null;
}

/* ---------- Export ---------- */
module.exports = {
  parseW2W,
  parseW2WFileSync
};