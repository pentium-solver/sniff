import { CheckCircle } from "lucide-react";
import { heroBullets, typingWords } from "@/lib/constants";
import Badge from "./Badge";
import Button from "./Button";
import TypingEffect from "./TypingEffect";
import ScreenshotPreview from "./ScreenshotPreview";

export default function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-accent/5 rounded-full blur-[120px] pointer-events-none" />

      <div className="relative mx-auto max-w-7xl px-6 py-20 lg:py-28">
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-16 items-center">
          {/* Left column - Text */}
          <div className="space-y-8">
            <Badge>An x-lock open source project</Badge>

            <h1 className="text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl lg:text-6xl xl:text-7xl">
              Intercept Android{" "}
              <br className="hidden sm:block" />
              <TypingEffect words={typingWords} />
            </h1>

            <p className="font-mono text-sm text-text-secondary tracking-wide uppercase">
              Real-time network analysis with SSL pinning bypass
            </p>

            <ul className="space-y-3">
              {heroBullets.map((bullet) => (
                <li
                  key={bullet}
                  className="flex items-start gap-3 text-text-secondary"
                >
                  <CheckCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-accent" />
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>

            <div className="flex flex-wrap gap-4">
              <Button href="/connect" size="lg">
                Get started now
              </Button>
              <Button href="#" variant="secondary" size="lg">
                View on GitHub
              </Button>
            </div>
          </div>

          {/* Right column - Screenshot */}
          <div className="lg:pl-8">
            <ScreenshotPreview />
          </div>
        </div>
      </div>
    </section>
  );
}
