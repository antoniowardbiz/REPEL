import { notFound } from "next/navigation";
import { PLAYBOOKS } from "@/lib/playbooks-config";

export const dynamic = "force-dynamic";

// Public, applicant-facing SOP page — same dark/red "void" skin as the trial
// page so it feels like one product. Linked from the trial brief.
const CSS = `
:root{--void:#0a0a0b;--surface:#131316;--red:#e10600;--ink:#f5f5f6;--ink-dim:#9a9aa0;--ink-faint:#59595f;
  --line:rgba(255,255,255,.08);--line2:rgba(255,255,255,.15);
  --mono:"JetBrains Mono",ui-monospace,monospace;--sans:"Inter",system-ui,sans-serif;--display:"Anton",system-ui,sans-serif;}
#pb{position:fixed;inset:0;z-index:60;overflow-y:auto;background:var(--void);color:var(--ink);font-family:var(--sans);line-height:1.6;font-size:16px}
#pb *{box-sizing:border-box;margin:0;padding:0}
#pb::before{content:"";position:fixed;inset:0;pointer-events:none;background:radial-gradient(680px 420px at 50% -120px,rgba(225,6,0,.13),transparent 68%)}
#pb .wrap{position:relative;max-width:720px;margin:0 auto;padding:26px 22px 90px}
#pb .bar{display:flex;align-items:center;gap:11px;padding-bottom:26px}
#pb .mark{width:30px;height:30px;background:var(--red);border-radius:6px;display:grid;place-items:center;font-family:var(--display);font-size:17px;color:#fff;box-shadow:0 0 20px rgba(225,6,0,.35)}
#pb .bar b{font-family:var(--display);font-size:18px;letter-spacing:.5px}
#pb .bar span{font-family:var(--mono);font-size:11px;color:var(--ink-faint);letter-spacing:.14em;text-transform:uppercase}
#pb .kicker{font-family:var(--mono);font-size:11.5px;letter-spacing:.2em;text-transform:uppercase;color:var(--ink-faint);margin-bottom:14px}
#pb .kicker i{color:var(--red);font-style:normal;margin-right:7px}
#pb h1{font-family:var(--display);font-weight:400;line-height:.95;letter-spacing:-.5px;text-transform:uppercase;font-size:clamp(38px,9vw,60px)}
#pb h1 em{color:var(--red);font-style:normal}
#pb .intro{max-width:60ch;margin-top:18px;color:var(--ink-dim);font-size:16.5px;border-bottom:1px solid var(--line);padding-bottom:28px}
#pb section{padding:26px 0;border-bottom:1px solid var(--line)}
#pb h2{font-family:var(--mono);font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:var(--red);margin-bottom:12px}
#pb p{color:var(--ink-dim);max-width:62ch}
#pb ul{margin:12px 0 0;padding-left:0;list-style:none}
#pb li{position:relative;padding-left:22px;margin:8px 0;color:var(--ink-dim)}
#pb li::before{content:"»";position:absolute;left:0;color:var(--red);font-family:var(--display)}
#pb li b,#pb p b{color:var(--ink);font-weight:600}
#pb footer{padding-top:28px;text-align:center;font-family:var(--mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-faint)}
#pb footer i{color:var(--red);font-style:normal}
`;

export default function PlaybookPage({ params }: { params: { role: string } }) {
  const pb = PLAYBOOKS[params.role];
  if (!pb) notFound();
  const [line1, ...rest] = pb.title.split(" — ");
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap"
        rel="stylesheet"
      />
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div id="pb">
        <div className="wrap">
          <div className="bar">
            <div className="mark">S»</div>
            <div>
              <b>SWIFT</b> <span>Playbook</span>
            </div>
          </div>
          <div className="kicker">
            <i>»</i>The Playbook
          </div>
          <h1>
            {line1} {rest.length > 0 && <em>{rest.join(" — ")}</em>}
          </h1>
          <p className="intro">{pb.intro}</p>
          {pb.sections.map((s, i) => (
            <section key={i}>
              <h2>{s.h}</h2>
              <p>{s.body}</p>
              {s.bullets && (
                <ul>
                  {s.bullets.map((b, j) => (
                    <li key={j}>{b}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}
          <footer>
            <i>»</i> SWIFT VA · Playbook
          </footer>
        </div>
      </div>
    </>
  );
}
