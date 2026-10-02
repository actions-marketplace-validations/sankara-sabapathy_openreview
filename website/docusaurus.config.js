// @ts-check
/** @type {import('@docusaurus/types').Config} */
const config = {
  title: "OpenReview AI",
  tagline: "Free BYOK multi-provider multi-agent PR review",
  favicon: "img/logo.svg",
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
        docs: { sidebarPath: "./sidebars.js", routeBasePath: "docs" },
        blog: false,
        theme: { customCss: "./src/css/custom.css" },
      }),
    ],
  ],
  themeConfig: {
    navbar: {
      title: "OpenReview AI",
      logo: { alt: "OpenReview AI", src: "img/logo.svg" },
      items: [
        { to: "/docs/", label: "Docs", position: "left" },
        {
          href: "https://github.com/marketplace/actions/openreview-ai",
          label: "Marketplace",
          position: "right",
        },
        {
          href: "https://github.com/sankara-sabapathy/openreview",
          label: "GitHub",
          position: "right",
        },
      ],
    },
    footer: {
      copyright: `MIT © ${new Date().getFullYear()} OpenReview — provided as-is; you own your keys, bills, and merges.`,
    },
  },
};
export default config;
