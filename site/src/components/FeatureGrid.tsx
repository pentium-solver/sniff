import { features } from "@/lib/constants";

export default function FeatureGrid() {
  return (
    <section id="features" className="border-t border-border">
      <div className="mx-auto max-w-7xl px-6 py-16 lg:py-24">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
            Everything you need to{" "}
            <span className="gradient-text">intercept traffic</span>
          </h2>
          <p className="mt-4 text-text-secondary max-w-2xl mx-auto">
            A complete toolkit for Android network analysis. From SSL pinning
            bypass to real-time traffic inspection, all in one terminal-based
            interface.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <div
                key={feature.title}
                className="group rounded-xl border border-border bg-card p-6 transition-all duration-200 hover:border-accent/15 hover:bg-bg-tertiary hover:-translate-y-0.5 hover:shadow-lg hover:shadow-accent/5"
              >
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-accent-dim">
                  <Icon className="h-5 w-5 text-accent-light" />
                </div>
                <h3 className="mb-2 text-lg font-bold">{feature.title}</h3>
                <p className="text-sm leading-relaxed text-text-secondary">
                  {feature.description}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
