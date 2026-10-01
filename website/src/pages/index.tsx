import Link from "@docusaurus/Link";
import useBaseUrl from "@docusaurus/useBaseUrl";
import Heading from "@theme/Heading";
import Layout from "@theme/Layout";

const FEATURES = [
  {
    title: "Any provider",
    body: "Claude, OpenAI, OpenCode Zen/Go, Groq, Ollama, Azure — any OpenAI- or Anthropic-shaped API via four config fields. Your keys, your bills.",
  },
  {
    title: "Main + subagents",
    body: "Each review fans out to specialist subagents, then a main synthesizes. Per-provider ballots resolve disagreement (any / all / majority).",
  },
  {
    title: "Real verdicts",
    body: "comment, approve, or request_changes with sticky summaries, inline findings, suggested fixes, and optional CI gating.",
  },
  {
    title: "Review templates",
    body: "Inherit shared config with extends — built-in drop-ins, community repos pinned by SHA, or local files.",
  },
  {
    title: "File context",
    body: "Agents see full changed files plus call-site excerpts, inside a token budget — not just bare hunks.",
  },
  {
    title: "Free forever",
    body: "MIT-licensed, runs in your Actions minutes. No seats, no SaaS, no lock-in.",
  },
];

function Feature({ title, body }) {
  return (
    <div className="col col--4" style={{ marginBottom: "1.5rem" }}>
      <div className="card" style={{ height: "100%" }}>
        <div className="card__header">
          <Heading as="h3">{title}</Heading>
        </div>
        <div className="card__body">
          <p>{body}</p>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <Layout
      title="Free BYOK multi-provider multi-agent PR review"
      description="OpenReview AI: free, open-source, BYOK multi-provider multi-agent PR reviewer for GitHub."
    >
      <header
        className="hero hero--primary"
        style={{ padding: "4rem 0", textAlign: "center" }}
      >
        <div className="container">
          <img
            src={useBaseUrl("/img/logo.svg")}
            alt="OpenReview AI"
            width="120"
            height="120"
            style={{ marginBottom: "1rem" }}
          />
          <Heading as="h1" className="hero__title">
            OpenReview AI
          </Heading>
          <p className="hero__subtitle">
            Free, open-source, BYOK multi-provider multi-agent PR reviewer for
            GitHub. Your keys, your models, your verdicts.
          </p>
          <div style={{ display: "flex", gap: "1rem", justifyContent: "center" }}>
            <Link
              className="button button--secondary button--lg"
              to="/docs/quickstart"
            >
              Get started
            </Link>
            <Link
              className="button button--outline button--lg"
              style={{ color: "white" }}
              href="https://github.com/sankara-sabapathy/openreview"
            >
              GitHub
            </Link>
          </div>
          <p style={{ marginTop: "1.5rem", opacity: 0.85 }}>
            <code>
              - uses: sankara-sabapathy/openreview@v1
            </code>
          </p>
        </div>
      </header>
      <main>
        <section className="container" style={{ padding: "3rem 0" }}>
          <div className="row">
            {FEATURES.map((f) => (
              <Feature key={f.title} {...f} />
            ))}
          </div>
        </section>
        <section
          style={{ background: "var(--ifm-color-emphasis-100)", padding: "2rem 0" }}
        >
          <div className="container" style={{ textAlign: "center" }}>
            <Heading as="h2">Live in 5 minutes</Heading>
            <p>
              Copy a workflow, add one secret, add one yaml — first review on
              your next PR.{" "}
              <Link to="/docs/quickstart">Follow the quickstart →</Link>
            </p>
            <p>
              <small>
                MIT-licensed, provided as-is. You own your keys, bills, and
                merges — a human must review before merging.
              </small>
            </p>
          </div>
        </section>
      </main>
    </Layout>
  );
}
