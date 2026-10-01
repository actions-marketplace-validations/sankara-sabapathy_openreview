import Link from "@docusaurus/Link";
import useBaseUrl from "@docusaurus/useBaseUrl";
import CodeBlock from "@theme/CodeBlock";
import Heading from "@theme/Heading";
import Layout from "@theme/Layout";
import styles from "./index.module.css";

const INSTALL_SNIPPET = `- uses: sankara-sabapathy/openreview@v1
  with:
    github-token: \${{ secrets.GITHUB_TOKEN }}
    opencode-api-key: \${{ secrets.OPENCODE_API_KEY }}`;

const CONFIG_SNIPPET = `version: 1
providers:
  go:
    protocol: openai-chat
    model: glm-5.3-flash
    base_url: https://opencode.ai/zen/go/v1
    key_from: secrets.OPENCODE_API_KEY
reviews:
  - id: general-quality
    main:
      provider: go
      instructions: "Be strict on bugs, lenient on style."
    subagents:
      - { name: correctness, provider: go,
          instructions: "Bugs, races, missing tests." }
    verdict: { mode: comment }`;

const REVIEW_ROWS = [
  { sev: "high", file: "auth/session.ts:41", text: "Session token compared with == — timing attack leaks validity. Use a constant-time compare.", agent: "security/codex" },
  { sev: "high", file: "db/users.ts:88", text: "Query interpolates userId directly. items[items.length] is undefined → NaN propagates to billing totals.", agent: "correctness/claude" },
  { sev: "medium", file: "api/payments.ts", text: "No idempotency key on the charge path — retries can double-bill. No test covers this.", agent: "correctness/claude" },
  { sev: "suggestion", file: "util/format.ts:12", text: "Dead helper trimAll — never imported anywhere. Delete it.", agent: "hygiene/opencode" },
];

type Cell = "yes" | "no" | "soon" | string;

const COMPARISON: { feature: string; cells: Cell[] }[] = [
  { feature: "Price", cells: ["$0 forever (MIT)", "from $24/dev/mo", "from $30/seat/mo", "Copilot plan required"] },
  { feature: "Open source", cells: ["yes", "no", "no", "no"] },
  { feature: "Bring your own key — any model", cells: ["yes", "no", "no", "no"] },
  { feature: "Multiple providers in one review", cells: ["yes", "no", "no", "no"] },
  { feature: "Claude subscription login (no API key)", cells: ["yes", "no", "no", "no"] },
  { feature: "Shareable review templates", cells: ["yes", "no", "no", "no"] },
  { feature: "Self-host anywhere (incl. own runners)", cells: ["yes", "no", "no", "no"] },
  { feature: "PR summaries & walkthroughs", cells: ["soon", "yes", "no", "no"] },
  { feature: "One-click / agent fix handoff", cells: ["soon", "yes", "yes", "yes"] },
  { feature: "Whole-codebase graph context", cells: ["soon", "no", "yes", "no"] },
];

const ROADMAP = [
  { name: "Incremental re-review", issue: 18, text: "Review only new pushes, validate fixes, keep a running ledger." },
  { name: "Suggested-fix patches", issue: 22, text: "Appliable suggestion blocks on every finding." },
  { name: "Reply handling (/ask)", issue: 23, text: "Ask why, challenge findings, in-thread." },
  { name: "Graph indexing", issue: 25, text: "CodeGraph/Graphify spike for impact analysis." },
  { name: "Feedback learning", issue: 43, text: "Reactions teach the reviewer what matters." },
];

function CellView({ cell }: { cell: Cell }) {
  if (cell === "yes") return <span className={styles.yes}>✓</span>;
  if (cell === "no") return <span className={styles.no}>—</span>;
  if (cell === "soon")
    return <span className={styles.soon}>Soon</span>;
  return <span className={styles.text}>{cell}</span>;
}

export default function Home() {
  return (
    <Layout
      title="Free BYOK multi-provider multi-agent PR review"
      description="OpenReview AI: free, open-source, BYOK multi-provider multi-agent PR reviewer for GitHub."
    >
      <div className={styles.page}>
        {/* HERO */}
        <header className={styles.hero}>
          <div className={styles.heroInner}>
            <div className={styles.badgeRow}>
              <span className={styles.badge}>v0.11.0</span>
              <span className={styles.badge}>MIT</span>
              <span className={styles.badge}>Marketplace</span>
            </div>
            <Heading as="h1" className={styles.title}>
              Code review that uses <span className={styles.grad}>your models</span>,
              <br />
              not your budget.
            </Heading>
            <p className={styles.subtitle}>
              OpenReview AI is a free, open-source GitHub Action for PR review.
              Bring any API key or your Claude subscription, pick the models per
              agent, and get staff-level reviews with enforceable verdicts.
            </p>
            <div className={styles.ctaRow}>
              <Link className={styles.ctaPrimary} to="/docs/quickstart">
                Get started in 5 min
              </Link>
              <Link
                className={styles.ctaGhost}
                href="https://github.com/marketplace/actions/openreview-ai"
              >
                Marketplace
              </Link>
            </div>
            <div className={styles.term}>
              <div className={styles.termBar}>
                <span />
                <span />
                <span />
                <em>.github/workflows/ai-review.yml</em>
              </div>
              <CodeBlock language="yaml">{INSTALL_SNIPPET}</CodeBlock>
            </div>
            <div className={styles.chips}>
              {["Claude", "OpenAI", "OpenCode Go/Zen", "Groq", "Ollama", "Azure", "OpenRouter"].map(
                (p) => (
                  <span key={p} className={styles.chip}>
                    {p}
                  </span>
                )
              )}
            </div>
          </div>
        </header>

        {/* LIVE REVIEW MOCK */}
        <section className={styles.section}>
          <div className={styles.container}>
            <Heading as="h2" className={styles.h2}>
              Reads like your strictest teammate
            </Heading>
            <p className={styles.lead}>
              Every PR gets a sticky verdict plus line-level findings — severity,
              evidence, and the agent that found it. No summary fluff.
            </p>
            <div className={styles.reviewCard}>
              <div className={styles.reviewHead}>
                <img
                  src={useBaseUrl("/img/logo.svg")}
                  alt="OpenReview AI"
                  width="24"
                  height="24"
                />
                <strong>OpenReview AI — COMMENT</strong>
                <span className={styles.runMeta}>general-quality · 4 findings</span>
              </div>
              <table className={styles.reviewTable}>
                <thead>
                  <tr>
                    <th>Severity</th>
                    <th>Finding</th>
                    <th>Agent</th>
                  </tr>
                </thead>
                <tbody>
                  {REVIEW_ROWS.map((r) => (
                    <tr key={r.file}>
                      <td>
                        <span className={`${styles.pill} ${styles[r.sev]}`}>
                          {r.sev}
                        </span>
                      </td>
                      <td>
                        <code>{r.file}</code>
                        <div className={styles.finding}>{r.text}</div>
                      </td>
                      <td>
                        <code>{r.agent}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section className={`${styles.section} ${styles.alt}`}>
          <div className={styles.container}>
            <Heading as="h2" className={styles.h2}>
              One yaml. Zero servers.
            </Heading>
            <p className={styles.lead}>
              It runs in your Actions minutes on your runners. Configure reviews,
              agents, and verdicts in <code>.github/openreview.yml</code>.
            </p>
            <div className={styles.split}>
              <div>
                <CodeBlock language="yaml" title=".github/openreview.yml">
                  {CONFIG_SNIPPET}
                </CodeBlock>
              </div>
              <ol className={styles.steps}>
                <li>
                  <strong>Add the workflow + one secret.</strong> Copy
                  <code> ai-review.yml</code>, store your provider key. Done.
                </li>
                <li>
                  <strong>Describe your reviewers.</strong> Main + subagents, each
                  with its own provider, model, and instructions.
                </li>
                <li>
                  <strong>Enforce the verdict.</strong> comment, approve, or
                  request_changes — with merge blocking and a usage footer on
                  every run.
                </li>
              </ol>
            </div>
          </div>
        </section>

        {/* COMPARISON */}
        <section className={styles.section}>
          <div className={styles.container}>
            <Heading as="h2" className={styles.h2}>
              How it compares
            </Heading>
            <p className={styles.lead}>
              Against the leading closed review tools, on facts from their
              public docs (Oct 2026). Ticks are shipped features; Soon is our
              public roadmap below.
            </p>
            <div className={styles.tableWrap}>
              <table className={styles.compare}>
                <thead>
                  <tr>
                    <th></th>
                    <th className={styles.us}>OpenReview AI</th>
                    <th>CodeRabbit</th>
                    <th>Greptile</th>
                    <th>Copilot</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON.map((row) => (
                    <tr key={row.feature}>
                      <td className={styles.feature}>{row.feature}</td>
                      {row.cells.map((c, i) => (
                        <td key={i}>
                          <CellView cell={c} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* ROADMAP */}
        <section className={`${styles.section} ${styles.alt}`}>
          <div className={styles.container}>
            <Heading as="h2" className={styles.h2}>
              Coming soon, in the open
            </Heading>
            <p className={styles.lead}>
              Every Soon above is a tracked public issue. Watch, vote, or shape it.
            </p>
            <div className={styles.cards}>
              {ROADMAP.map((r) => (
                <a
                  key={r.issue}
                  className={styles.card}
                  href={`https://github.com/sankara-sabapathy/openreview/issues/${r.issue}`}
                >
                  <span className={styles.soon}>Soon · #{r.issue}</span>
                  <strong>{r.name}</strong>
                  <p>{r.text}</p>
                </a>
              ))}
            </div>
          </div>
        </section>

        {/* FINAL CTA */}
        <section className={styles.section}>
          <div className={`${styles.container} ${styles.center}`}>
            <Heading as="h2" className={styles.h2}>
              Review your next PR for $0.
            </Heading>
            <div className={styles.ctaRow}>
              <Link className={styles.ctaPrimary} to="/docs/quickstart">
                Read the quickstart
              </Link>
              <Link
                className={styles.ctaGhostDark}
                href="https://github.com/sankara-sabapathy/openreview"
              >
                Star on GitHub
              </Link>
            </div>
            <p>
              <small>
                MIT-licensed, provided as-is. You own your keys, bills, and
                merges — a human must review before merging.
              </small>
            </p>
          </div>
        </section>
      </div>
    </Layout>
  );
}
