"use strict";

/**
 * 우리 가족 일정표 - 백엔드 서버
 *
 * 정적 프론트엔드(public/)를 제공하고, 네이버 캘린더 연동에 필요한
 * OAuth 2.0 로그인과 일정 등록 API 프록시를 담당합니다.
 *
 * client_secret 은 이 서버에만 두고 브라우저로 절대 내보내지 않습니다.
 */

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");

const {
  NAVER_CLIENT_ID,
  NAVER_CLIENT_SECRET,
  NAVER_CALLBACK_URL,
  SESSION_SECRET,
  PORT = 3000,
} = process.env;

const naverConfigured = Boolean(
  NAVER_CLIENT_ID && NAVER_CLIENT_SECRET && NAVER_CALLBACK_URL
);

if (!naverConfigured) {
  console.warn(
    "[경고] 네이버 환경변수(NAVER_CLIENT_ID/SECRET/CALLBACK_URL)가 설정되지 않았습니다.\n" +
      "        앱은 정상 동작하지만 네이버 캘린더 연동은 비활성화됩니다. (.env.example 참고)"
  );
}

const app = express();
app.disable("x-powered-by");

// Render 등 리버스 프록시 뒤(https)에서는 trust proxy 를 켜야
// secure 쿠키(세션)가 정상 발급됩니다. (X-Forwarded-Proto 신뢰)
const behindHttpsProxy = String(NAVER_CALLBACK_URL || "").startsWith("https://");
if (behindHttpsProxy) app.set("trust proxy", 1);

app.use(express.json({ limit: "64kb" }));

app.use(
  session({
    name: "fs.sid",
    secret: SESSION_SECRET || crypto.randomBytes(32).toString("hex"),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: behindHttpsProxy,
      maxAge: 1000 * 60 * 60 * 24 * 30, // 30일
    },
  })
);

// ---------- iCalendar 생성 ----------

function escapeIcs(text) {
  return String(text || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function pad(n) {
  return n < 10 ? "0" + n : "" + n;
}

// 로컬(Asia/Seoul) 날짜/시간 문자열: YYYYMMDDTHHMMSS
function localStamp(dateStr, timeStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  let hh = 0;
  let mm = 0;
  if (timeStr) {
    const t = timeStr.split(":").map(Number);
    hh = t[0] || 0;
    mm = t[1] || 0;
  }
  return (
    y + pad(m) + pad(d) + "T" + pad(hh) + pad(mm) + "00"
  );
}

function dateOnly(dateStr) {
  return dateStr.replace(/-/g, "");
}

// 시작 시각에 시간(hours) 더한 뒤 로컬 스탬프 반환
function addHoursStamp(dateStr, timeStr, hours) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = (timeStr || "00:00").split(":").map(Number);
  const dt = new Date(y, m - 1, d, t[0] || 0, t[1] || 0, 0);
  dt.setHours(dt.getHours() + hours);
  return (
    dt.getFullYear() +
    pad(dt.getMonth() + 1) +
    pad(dt.getDate()) +
    "T" +
    pad(dt.getHours()) +
    pad(dt.getMinutes()) +
    "00"
  );
}

// 하루 뒤 날짜(YYYYMMDD) - 종일 일정의 DTEND(exclusive)용
function nextDay(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + 1);
  return dt.getFullYear() + pad(dt.getMonth() + 1) + pad(dt.getDate());
}

function repeatToRrule(repeat) {
  switch (repeat) {
    case "daily":
      return "RRULE:FREQ=DAILY";
    case "weekly":
      return "RRULE:FREQ=WEEKLY";
    case "biweekly":
      return "RRULE:FREQ=WEEKLY;INTERVAL=2";
    case "monthly":
      return "RRULE:FREQ=MONTHLY";
    default:
      return null;
  }
}

function utcStamp() {
  // Naver 예제의 DTSTAMP 형식: YYYYMMDDTHHMMSSZ (UTC)
  const d = new Date();
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

function buildIcs(ev) {
  const uid = crypto.randomBytes(12).toString("hex") + "@family-schedule";
  const stamp = utcStamp();

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Family Schedule//KO",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    "UID:" + uid,
    "DTSTAMP:" + stamp,
    "CREATED:" + stamp,
    "LAST-MODIFIED:" + stamp,
  ];

  if (ev.allday) {
    lines.push("DTSTART;VALUE=DATE:" + dateOnly(ev.date));
    lines.push("DTEND;VALUE=DATE:" + nextDay(ev.date));
  } else {
    lines.push("DTSTART;TZID=Asia/Seoul:" + localStamp(ev.date, ev.time));
    // 종료 시각 미지정 시 1시간짜리 일정으로 생성
    lines.push("DTEND;TZID=Asia/Seoul:" + addHoursStamp(ev.date, ev.time, 1));
  }

  lines.push("SUMMARY:" + escapeIcs(ev.title));
  if (ev.note) lines.push("DESCRIPTION:" + escapeIcs(ev.note));

  const rrule = repeatToRrule(ev.repeat);
  if (rrule) lines.push(rrule);

  lines.push("END:VEVENT", "END:VCALENDAR");

  // iCalendar 표준 줄바꿈은 CRLF
  return lines.join("\r\n");
}

// ---------- 네이버 OAuth ----------

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch (e) {
    body = { _raw: text };
  }
  return { ok: res.ok, status: res.status, body };
}

async function exchangeCodeForToken(code, state) {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: NAVER_CLIENT_ID,
    client_secret: NAVER_CLIENT_SECRET,
    code,
    state,
  });
  return fetchJson(
    "https://nid.naver.com/oauth2.0/token?" + params.toString(),
    { method: "GET" }
  );
}

async function refreshAccessToken(refreshToken) {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: NAVER_CLIENT_ID,
    client_secret: NAVER_CLIENT_SECRET,
    refresh_token: refreshToken,
  });
  return fetchJson(
    "https://nid.naver.com/oauth2.0/token?" + params.toString(),
    { method: "GET" }
  );
}

async function createNaverSchedule(accessToken, icsString) {
  const params = new URLSearchParams({
    calendarId: "defaultCalendarId",
    scheduleIcalString: icsString,
  });
  return fetchJson("https://openapi.naver.com/calendar/createSchedule.json", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + accessToken,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
}

// ---------- 라우트 ----------

// 연결 상태
app.get("/api/naver/status", (req, res) => {
  res.json({
    configured: naverConfigured,
    connected: Boolean(req.session && req.session.naver && req.session.naver.accessToken),
  });
});

// 로그인 시작 → 네이버 인증 페이지로 리다이렉트
app.get("/api/naver/login", (req, res) => {
  if (!naverConfigured) {
    return res.status(503).send("네이버 연동이 설정되지 않았습니다.");
  }
  const state = crypto.randomBytes(16).toString("hex");
  req.session.oauthState = state;
  const params = new URLSearchParams({
    response_type: "code",
    client_id: NAVER_CLIENT_ID,
    redirect_uri: NAVER_CALLBACK_URL,
    state,
  });
  res.redirect("https://nid.naver.com/oauth2.0/authorize?" + params.toString());
});

// 콜백 → 토큰 교환 후 앱으로 복귀
app.get("/api/naver/callback", async (req, res) => {
  const { code, state, error, error_description } = req.query;
  if (error) {
    return res.redirect("/?naver=error");
  }
  if (!code || !state || state !== req.session.oauthState) {
    return res.redirect("/?naver=state_mismatch");
  }
  delete req.session.oauthState;

  try {
    const { ok, body } = await exchangeCodeForToken(code, state);
    if (!ok || !body.access_token) {
      return res.redirect("/?naver=token_error");
    }
    req.session.naver = {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
    };
    res.redirect("/?naver=connected");
  } catch (e) {
    res.redirect("/?naver=token_error");
  }
});

// 연결 해제
app.post("/api/naver/logout", (req, res) => {
  if (req.session) req.session.naver = null;
  res.json({ ok: true });
});

// 일정 등록 (필요 시 토큰 자동 갱신 후 1회 재시도)
app.post("/api/naver/schedule", async (req, res) => {
  if (!naverConfigured) {
    return res.status(503).json({ error: "not_configured", message: "네이버 연동 미설정" });
  }
  const sess = req.session && req.session.naver;
  if (!sess || !sess.accessToken) {
    return res.status(401).json({ error: "not_connected", message: "네이버 미연결" });
  }

  const ev = req.body || {};
  if (!ev.title || !ev.date) {
    return res.status(400).json({ error: "invalid", message: "제목과 날짜가 필요합니다." });
  }

  let ics;
  try {
    ics = buildIcs(ev);
  } catch (e) {
    return res.status(400).json({ error: "invalid", message: "일정 형식 오류" });
  }

  try {
    let result = await createNaverSchedule(sess.accessToken, ics);

    // 토큰 만료(401) 시 refresh_token 으로 1회 갱신 후 재시도
    if (result.status === 401 && sess.refreshToken) {
      const refreshed = await refreshAccessToken(sess.refreshToken);
      if (refreshed.ok && refreshed.body.access_token) {
        sess.accessToken = refreshed.body.access_token;
        result = await createNaverSchedule(sess.accessToken, ics);
      } else {
        req.session.naver = null;
        return res.status(401).json({ error: "not_connected", message: "토큰 만료" });
      }
    }

    if (result.ok && result.body && result.body.result === "success") {
      return res.json({ result: "success", returnValue: result.body.returnValue });
    }
    return res.status(502).json({
      error: "naver_error",
      message:
        (result.body && (result.body.errorMessage || result.body.message)) ||
        "네이버 API 오류",
      detail: result.body,
    });
  } catch (e) {
    return res.status(502).json({ error: "network", message: "네이버 API 호출 실패" });
  }
});

// ---------- 정적 파일 ----------
app.use(express.static(path.join(__dirname, "public")));

if (require.main === module) {
  app.listen(PORT, () => {
    console.log("우리 가족 일정표 서버 실행 중: http://localhost:" + PORT);
  });
}

module.exports = { app, buildIcs, repeatToRrule };
