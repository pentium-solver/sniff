import { CheckCircle } from "lucide-react";
import { heroBullets, typingWords } from "@/lib/constants";
import Badge from "./Badge";
import Button from "./Button";
import TypingEffect from "./TypingEffect";
import ScreenshotPreview from "./ScreenshotPreview";

export default function Hero() {
  return (
    <section className="relative overflow-hidden min-h-screen flex items-center justify-center pt-20">
      {/* Refined Mesh Gradient Background */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] rounded-full bg-accent/10 blur-[140px] animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-brand/10 blur-[120px]" />
        <div className="absolute top-[20%] right-[20%] w-[30%] h-[30%] rounded-full bg-accent-bright/5 blur-[100px]" />
        {/* Grain Overlay */}
        <div className="absolute inset-0 opacity-[0.15] mix-blend-overlay pointer-events-none" 
             style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")` }}>
        </div>
      </div>

      <div className="relative mx-auto max-w-7xl px-6 py-12 lg:py-20 w-full text-center">
        {/* Top Tags - High-end Glassmorphism */}
        <div className="flex justify-center gap-3 mb-10 animate-fade-in-up">
          {["HTTP/2", "TLS 1.3", "gRPC"].map((tag) => (
            <span
              key={tag}
              className="px-4 py-1.5 rounded-full text-[11px] font-bold tracking-widest uppercase bg-white/[0.03] border border-white/[0.08] backdrop-blur-xl text-text-secondary shadow-2xl hover:border-white/20 hover:text-foreground transition-all duration-300 cursor-default"
            >
              {tag}
            </span>
          ))}
        </div>

        <div className="space-y-10 max-w-5xl mx-auto">
          <Badge className="bg-brand-dim/30 text-brand-light border-brand/20 py-1.5 px-5">
            The professional Android interceptor
          </Badge>

          <h1 className="text-6xl font-extrabold leading-[1.05] tracking-tight sm:text-7xl lg:text-8xl xl:text-9xl">
            Intercept Android{" "}
            <br />
            <TypingEffect words={typingWords} />
          </h1>

          <p className="text-xl sm:text-2xl text-text-secondary max-w-3xl mx-auto leading-relaxed font-medium">
            Universal SSL pinning bypass, real-time traffic analysis, and automated Frida injection. Built for security researchers.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-6 pt-8">
            <Button href="/connect" size="lg" className="h-16 px-12 text-lg shadow-[0_0_30px_rgba(59,111,246,0.3)] hover:scale-105 transition-transform duration-300">
              Get started
            </Button>
            <Button href="/docs" variant="secondary" size="lg" className="h-16 px-12 text-lg backdrop-blur-md bg-white/[0.02] hover:bg-white/[0.05]">
              View documentation
            </Button>
          </div>
          
          <div className="pt-16 opacity-50 grayscale hover:grayscale-0 transition-all duration-700">
            <ScreenshotPreview />
          </div>
        </div>
      </div>
    </section>
  );
}
