import { notFound } from "next/navigation";
import { getTrainingByToken } from "@/lib/training";
import Quiz from "@/components/Quiz";
import { winsForRole, PAYOUT_STATS, WINS_CHANNEL_HANDLE, WINS_CHANNEL_URL } from "@/lib/testimonials-config";

export const dynamic = "force-dynamic";

// Scoped skin for the applicant-facing trial page — a self-contained dark/red
// "void" aesthetic that fully covers the operator dashboard chrome. Everything
// is scoped under #trial so it can't leak into the rest of the app.
const TRIAL_CSS = `
:root{
  --void:#0a0a0b; --surface:#131316; --raised:#1b1b1f;
  --red:#e10600; --red-deep:#3d0806;
  --ink:#f5f5f6; --ink-dim:#9a9aa0; --ink-faint:#59595f;
  --line:rgba(255,255,255,.08); --line-strong:rgba(255,255,255,.15);
  --mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
  --sans:"Inter",system-ui,-apple-system,sans-serif;
  --display:"Anton","Arial Narrow",system-ui,sans-serif;
}
#trial{position:fixed;inset:0;z-index:60;overflow-y:auto;background:var(--void);color:var(--ink);
  font-family:var(--sans);line-height:1.55;font-size:16px;-webkit-font-smoothing:antialiased}
#trial *{box-sizing:border-box;margin:0;padding:0}
#trial::before{content:"";position:fixed;inset:0;pointer-events:none;z-index:0;
  background:radial-gradient(680px 420px at 50% -120px, rgba(225,6,0,.13), transparent 68%)}
#trial .wrap{position:relative;z-index:1;max-width:720px;margin:0 auto;padding:26px 22px 90px}
#trial .bar{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-bottom:30px}
#trial .brand{display:flex;align-items:center;gap:11px}
#trial .mark{width:30px;height:30px;background:var(--red);border-radius:6px;display:grid;place-items:center;
  font-family:var(--display);font-size:17px;color:#fff;letter-spacing:-1px;box-shadow:0 0 20px rgba(225,6,0,.35)}
#trial .brand b{font-family:var(--display);font-size:18px;letter-spacing:.5px}
#trial .brand span{font-family:var(--mono);font-size:11px;color:var(--ink-faint);letter-spacing:.14em;text-transform:uppercase}
#trial .chip{display:inline-flex;align-items:center;gap:8px;font-family:var(--mono);font-size:10.5px;letter-spacing:.14em;
  text-transform:uppercase;color:var(--ink-dim);border:1px solid var(--line-strong);border-radius:999px;padding:7px 13px;white-space:nowrap}
#trial .dot{width:7px;height:7px;border-radius:50%;background:var(--ink-faint)}
#trial .chip.unlocked{color:var(--red);border-color:var(--red)}
#trial .chip.unlocked .dot{background:var(--red);box-shadow:0 0 10px var(--red)}
#trial .hero{padding:6px 0 34px;border-bottom:1px solid var(--line)}
#trial .kicker{font-family:var(--mono);font-size:11.5px;letter-spacing:.2em;text-transform:uppercase;color:var(--ink-faint);margin-bottom:16px}
#trial .kicker i{color:var(--red);font-style:normal;margin-right:7px}
#trial h1{font-family:var(--display);font-weight:400;line-height:.9;letter-spacing:-.5px;text-transform:uppercase}
#trial h1 .l1{display:block;font-size:clamp(46px,12vw,78px)}
#trial h1 .l2{display:block;font-size:clamp(46px,12vw,78px);color:var(--red)}
#trial .mission{max-width:52ch;margin-top:20px;color:var(--ink-dim);font-size:16.5px}
#trial .mission b{color:var(--ink);font-weight:600}
#trial section{padding:34px 0;border-bottom:1px solid var(--line)}
#trial .eyebrow{font-family:var(--mono);font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:var(--ink-faint);margin-bottom:20px}
#trial .eyebrow i{color:var(--red);font-style:normal;margin-right:9px;font-weight:700}
#trial .lede{color:var(--ink-dim);max-width:60ch;font-size:16px;white-space:pre-wrap}
#trial .lede b{color:var(--ink);font-weight:600}
#trial .gatehead{display:flex;align-items:baseline;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:8px}
#trial .gatehead h2{font-family:var(--display);font-weight:400;font-size:30px;letter-spacing:.5px;text-transform:uppercase}
#trial .meter{font-family:var(--mono);font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-dim)}
#trial .meter b{color:var(--red)}
#trial .gatesub{color:var(--ink-faint);font-family:var(--mono);font-size:12px;letter-spacing:.06em;margin-bottom:26px}
#trial .q{margin-bottom:24px}
#trial .q-h{display:flex;gap:12px;margin-bottom:12px}
#trial .q-n{font-family:var(--mono);font-size:13px;color:var(--red);font-weight:700;flex-shrink:0;padding-top:2px}
#trial .q-t{font-weight:600;font-size:16px;color:var(--ink)}
#trial .opts{display:flex;flex-direction:column;gap:8px;padding-left:25px}
#trial .opt{display:flex;align-items:center;gap:12px;width:100%;text-align:left;cursor:pointer;background:var(--surface);
  border:1px solid var(--line);border-radius:9px;padding:13px 15px;color:var(--ink-dim);font-family:var(--sans);font-size:14.5px;
  transition:border-color .16s ease,background .16s ease,color .16s ease}
#trial .opt:hover{border-color:var(--line-strong);color:var(--ink);background:var(--raised)}
#trial .opt .box{width:19px;height:19px;border-radius:5px;border:1.5px solid var(--line-strong);flex-shrink:0;
  display:grid;place-items:center;font-family:var(--mono);font-size:11px;color:transparent;transition:.16s ease}
#trial .opt.sel{border-color:var(--red);color:var(--ink);background:var(--raised)}
#trial .opt.sel .box{border-color:var(--red);background:var(--red);color:#fff}
#trial .opt.sel .box::after{content:"»"}
#trial .graded .opt{cursor:default;pointer-events:none}
#trial .opt.correct{border-color:var(--red);background:rgba(225,6,0,.08);color:#fff}
#trial .opt.correct .box{border-color:var(--red);background:var(--red);color:#fff}
#trial .opt.correct .box::after{content:"✓"}
#trial .opt.wrong{border-color:var(--line);background:transparent;color:var(--ink-faint);text-decoration:line-through}
#trial .opt.wrong .box{border-color:var(--ink-faint);background:transparent;color:var(--ink-faint)}
#trial .opt.wrong .box::after{content:"×"}
#trial .submit{margin-top:8px;width:100%;font-family:var(--display);font-weight:400;font-size:19px;letter-spacing:1.5px;
  text-transform:uppercase;color:#fff;background:var(--red);border:none;border-radius:10px;padding:16px;cursor:pointer;transition:.2s ease}
#trial .submit:hover:not(:disabled){box-shadow:0 8px 30px rgba(225,6,0,.35)}
#trial .submit:disabled{background:var(--raised);color:var(--ink-faint);cursor:not-allowed}
#trial .result{margin-top:22px;border:1px solid var(--line-strong);border-radius:12px;padding:24px;background:var(--surface)}
#trial .result.pass{border-color:var(--red);box-shadow:0 0 40px rgba(225,6,0,.18)}
#trial .r-chev{font-family:var(--display);color:var(--red);font-size:26px;letter-spacing:-4px;margin-bottom:6px}
#trial .r-status{font-family:var(--display);font-weight:400;font-size:34px;letter-spacing:.5px;text-transform:uppercase;line-height:1}
#trial .result.pass .r-status{color:var(--red)}
#trial .r-score{font-family:var(--mono);font-size:13px;letter-spacing:.08em;color:var(--ink-dim);margin-top:12px}
#trial .r-score b{color:var(--ink)}
#trial .r-msg{color:var(--ink-dim);font-size:14.5px;margin-top:10px;max-width:48ch}
#trial .r-cta{margin-top:18px;display:inline-flex;align-items:center;gap:9px;font-family:var(--display);font-size:16px;
  letter-spacing:1px;text-transform:uppercase;color:var(--ink);background:transparent;border:1px solid var(--line-strong);
  border-radius:9px;padding:12px 22px;cursor:pointer;transition:.2s ease}
#trial .r-cta:hover{transform:translateY(-1px);border-color:var(--red);color:#fff}
#trial .msgcard{margin-top:20px;border:1px solid var(--line);background:var(--surface);border-radius:12px;padding:24px;color:var(--ink-dim);font-size:15px}
#trial .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
#trial .stat{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:14px 10px;text-align:center}
#trial .stat b{display:block;font-family:var(--display);font-weight:400;font-size:24px;color:var(--red);letter-spacing:.5px}
#trial .stat span{display:block;margin-top:5px;font-family:var(--mono);font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-faint)}
#trial .winrow{display:flex;align-items:center;justify-content:space-between;gap:12px;background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:12px 15px;margin-top:8px}
#trial .winrow .who{font-size:14px;color:var(--ink)}
#trial .winrow .who em{font-style:normal;color:var(--ink-faint)}
#trial .winrow .amt{font-family:var(--display);font-size:22px;color:var(--red);white-space:nowrap}
#trial .winrow .per{font-family:var(--mono);font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-faint);text-align:right}
#trial .winlink{display:flex;align-items:center;justify-content:center;gap:8px;margin-top:12px;border:1px solid var(--line-strong);border-radius:9px;padding:11px;font-family:var(--mono);font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-dim);text-decoration:none;transition:.2s ease}
#trial .winlink:hover{border-color:var(--red);color:#fff}
@media (max-width:520px){#trial .stats{grid-template-columns:1fr 1fr}}
#trial footer{padding-top:34px;text-align:center;font-family:var(--mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-faint)}
#trial footer i{color:var(--red);font-style:normal}
@keyframes trial-rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
#trial .result{animation:trial-rise .4s ease}
@media (max-width:520px){
  #trial .wrap{padding:20px 16px 70px}
  #trial h1 .l1,#trial h1 .l2{font-size:clamp(40px,15vw,60px)}
  #trial .opts{padding-left:0}
}
`;

function Shell({ children, unlocked }: { children: React.ReactNode; unlocked?: boolean }) {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap"
        rel="stylesheet"
      />
      <style dangerouslySetInnerHTML={{ __html: TRIAL_CSS }} />
      <div id="trial">
        <div className="wrap">
          <div className="bar">
            <div className="brand">
              <div className="mark">S»</div>
              <div>
                <b>SWIFT</b> <span>VA · pipeline</span>
              </div>
            </div>
            <div className={`chip ${unlocked ? "unlocked" : ""}`}>
              <span className="dot" />
              <span>{unlocked ? "Trial · Unlocked" : "Trial · Locked"}</span>
            </div>
          </div>
          {children}
          <footer>
            <i>»</i> SWIFT VA · Trial Gate · REPEL
          </footer>
        </div>
      </div>
    </>
  );
}

export default async function TrainingPage({ params }: { params: { token: string } }) {
  const view = await getTrainingByToken(params.token);
  if (!view) notFound();

  const role = view.roleName || "Your Role";

  if (view.status === "no_role" || view.status === "no_module") {
    return (
      <Shell>
        <div className="hero">
          <div className="kicker">
            <i>»</i>
            {view.candidateName} · SWIFT VA
          </div>
          <h1>
            <span className="l1">Almost</span>
            <span className="l2">There</span>
          </h1>
        </div>
        <div className="msgcard">
          {view.status === "no_role"
            ? "You don't have a role selected yet, so there's no training assigned. We'll message you on Telegram once your role is set."
            : "There's no training module for your role yet. Watch your Telegram for next steps."}
        </div>
      </Shell>
    );
  }

  if (view.status === "unlocked") {
    return (
      <Shell unlocked>
        <div className="hero">
          <div className="kicker">
            <i>»</i>
            {role} · Trial Module
          </div>
          <h1>
            <span className="l1">Trial</span>
            <span className="l2">Unlocked</span>
          </h1>
          <p className="mission">
            Training complete{view.lastAttempt ? ` — you scored ${view.lastAttempt.score}%.` : "."}{" "}
            <b>Check your Telegram</b> for the brief and your task.
          </p>
        </div>
      </Shell>
    );
  }

  // status === "ready"
  const mod = view.module!;
  return (
    <Shell>
      <div className="hero">
        <div className="kicker">
          <i>»</i>
          {role} · Trial Module 01
        </div>
        <h1>
          <span className="l1">{role}</span>
          <span className="l2">Trial Training</span>
        </h1>
        <p className="mission">
          Read this end to end — it&apos;s exactly what a <b>great trial</b> looks like, and the
          fastest path to getting hired and earning. Pass the gate below to unlock your trial.
        </p>
      </div>

      {/* Payout proof — motivation before the playbook */}
      <section>
        <div className="eyebrow">
          <i>»</i>Team wins — real payouts
        </div>
        <div className="stats">
          {PAYOUT_STATS.map((s) => (
            <div className="stat" key={s.label}>
              <b>{s.value}</b>
              <span>{s.label}</span>
            </div>
          ))}
        </div>
        {winsForRole(role).map((w, i) => (
          <div className="winrow" key={i}>
            <div className="who">
              {w.handle} <em>· {w.role}</em>
              {w.note && <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 2 }}>{w.note}</div>}
            </div>
            <div>
              <div className="amt">{w.amount}</div>
              <div className="per">{w.period}</div>
            </div>
          </div>
        ))}
        <a className="winlink" href={WINS_CHANNEL_URL} target="_blank" rel="noopener">
          See live payouts → {WINS_CHANNEL_HANDLE}
        </a>
      </section>

      <section>
        <div className="eyebrow">
          <i>»</i>The playbook
        </div>
        <div className="lede">{mod.content}</div>
      </section>

      {view.lastAttempt && !view.lastAttempt.passed && (
        <div className="gatesub" style={{ marginTop: 18, color: "var(--red)" }}>
          Last attempt: {view.lastAttempt.score}% — you need {mod.passPct}%. Give it another go.
        </div>
      )}

      <section style={{ borderBottom: "none" }}>
        <Quiz token={params.token} passPct={mod.passPct} questions={mod.questions} />
      </section>
    </Shell>
  );
}
