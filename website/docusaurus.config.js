// @ts-check
/** @type {import('@docusaurus/types').Config} */
const config = {
  title: "OpenReview",
  tagline: "Free BYOK multi-provider multi-agent PR review",
  favicon: "img/favicon.ico",
  url: "https://sankara-sabapathy.github.io",
  baseUrl: "/openreview/",
  organizationName: "sankara-sabapathy",
  projectName: "openreview",
  onBrokenLinks: "throw",
  markdown: { hooks: { onBrokenMarkdownLinks: "warn" } },
  presets: [
    [
      "classic",
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: { sidebarPath: "./sidebars.js", routeBasePath: "/" },
        blog: false,
        theme: { customCss: "./src/css/custom.css" },
      }),
    ],
  ],
  themeConfig: {
    navbar: {
      title: "OpenReview",
      items: [{ to: "/", label: "Docs", position: "left" }],
    },
    footer: { copyright: `MIT © ${new Date().getFullYear()} OpenReview` },
  },
};
export default config;
