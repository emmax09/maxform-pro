import { Zap, ArrowRight, CheckCircle2, Users, TrendingUp, FileText, Cog } from "lucide-react";

export const HeroIllustration = () => {
  return (
    <>
      {/* Desktop Workflow Illustration */}
      <div className="hidden lg:block flex-1 relative z-[1] min-w-0">
        <div className="absolute top-1/2 right-0 -translate-y-1/2 w-full max-w-[520px] h-[420px]">
          <div className="relative w-full h-full flex items-center justify-center">
            
            {/* Background decorative elements */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-gradient-to-br from-primary/10 via-primary/5 to-transparent rounded-full blur-3xl" />
            
            {/* Central Flow Visualization */}
            <div className="relative w-full h-full flex items-center justify-center">
              
              {/* Step 1: Form Submission */}
              <div className="absolute left-8 top-1/2 -translate-y-1/2 flex flex-col items-center gap-3">
                <div className="relative">
                  <div className="h-24 w-24 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border-2 border-primary/30 flex items-center justify-center shadow-lg">
                    <FileText className="h-10 w-10 text-primary" />
                  </div>
                  {/* Pulse effect */}
                  <div className="absolute inset-0 h-24 w-24 rounded-2xl bg-primary/20 animate-ping" style={{ animationDuration: '3s' }} />
                </div>
                <div className="text-center">
                  <div className="text-[11px] font-semibold text-foreground">Submit</div>
                  <div className="text-[9px] text-muted-foreground">Data comes in</div>
                </div>
              </div>

              {/* Arrow 1 */}
              <div className="absolute left-36 top-1/2 -translate-y-1/2 flex items-center gap-1">
                <div className="w-16 h-0.5 bg-gradient-to-r from-primary/60 to-primary/30" />
                <ArrowRight className="h-4 w-4 text-primary/60" />
              </div>

              {/* Step 2: Smart Workflow */}
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-3 z-10">
                <div className="relative">
                  <div className="h-28 w-28 rounded-2xl bg-gradient-to-br from-primary/30 to-primary/10 border-2 border-primary/40 flex items-center justify-center shadow-xl">
                    <Cog className="h-12 w-12 text-primary animate-spin" style={{ animationDuration: '4s' }} />
                  </div>
                  {/* Rotating ring */}
                  <div className="absolute inset-0 h-28 w-28 rounded-2xl border-2 border-primary/20 animate-spin" style={{ animationDuration: '8s', animationDirection: 'reverse' }} />
                </div>
                <div className="text-center">
                  <div className="text-[12px] font-bold text-foreground">Automate</div>
                  <div className="text-[9px] text-muted-foreground">Smart workflows</div>
                </div>
              </div>

              {/* Arrow 2 */}
              <div className="absolute right-36 top-1/2 -translate-y-1/2 flex items-center gap-1">
                <ArrowRight className="h-4 w-4 text-primary/60" />
                <div className="w-16 h-0.5 bg-gradient-to-r from-primary/30 to-primary/60" />
              </div>

              {/* Step 3: Results */}
              <div className="absolute right-8 top-1/2 -translate-y-1/2 flex flex-col items-center gap-3">
                <div className="relative">
                  <div className="h-24 w-24 rounded-2xl bg-gradient-to-br from-success/20 to-success/5 border-2 border-success/30 flex items-center justify-center shadow-lg">
                    <CheckCircle2 className="h-10 w-10 text-success" />
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-[11px] font-semibold text-foreground">Results</div>
                  <div className="text-[9px] text-muted-foreground">Work is done</div>
                </div>
              </div>

              {/* Floating Benefit Cards */}
              <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-background/95 backdrop-blur-sm border-2 border-border rounded-xl px-4 py-2 shadow-xl">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  <span className="text-[10px] font-medium text-foreground">10x faster processing</span>
                </div>
              </div>

              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-background/95 backdrop-blur-sm border-2 border-border rounded-xl px-4 py-2 shadow-xl">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-success" />
                  <span className="text-[10px] font-medium text-foreground">50+ happy users</span>
                </div>
              </div>

              {/* Data Flow Particles */}
              <div className="absolute left-32 top-1/3 w-2 h-2 rounded-full bg-primary/40 animate-[float_2s_ease-in-out_infinite]" />
              <div className="absolute left-40 top-1/2 w-1.5 h-1.5 rounded-full bg-primary/30 animate-[float_3s_ease-in-out_infinite_0.5s]" />
              <div className="absolute right-32 top-2/3 w-2 h-2 rounded-full bg-success/40 animate-[float_2.5s_ease-in-out_infinite]" />
              <div className="absolute right-40 top-1/2 w-1.5 h-1.5 rounded-full bg-success/30 animate-[float_3s_ease-in-out_infinite_1s]" />
            </div>
          </div>
        </div>
      </div>

      {/* Mobile/Tablet simplified view - HORIZONTAL LAYOUT */}
      <div className="lg:hidden mt-4 w-full px-4">
        <div className="relative py-4">
          <div className="relative flex items-center justify-center gap-3">
            
            {/* Background glow */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-[200px] bg-gradient-to-br from-primary/10 via-primary/5 to-transparent rounded-full blur-3xl" />

            {/* Step 1 */}
            <div className="relative flex flex-col items-center gap-1.5 z-10">
              <div className="h-16 w-16 sm:h-20 sm:w-20 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border-2 border-primary/30 flex items-center justify-center shadow-lg">
                <FileText className="h-7 w-7 sm:h-8 sm:w-8 text-primary" />
              </div>
              <div className="text-center">
                <div className="text-[10px] sm:text-[11px] font-semibold text-foreground">Submit</div>
              </div>
            </div>

            <ArrowRight className="h-4 w-4 sm:h-5 sm:w-5 text-primary/60 shrink-0" />

            {/* Step 2 */}
            <div className="relative flex flex-col items-center gap-1.5 z-10">
              <div className="h-18 w-18 sm:h-24 sm:w-24 rounded-xl bg-gradient-to-br from-primary/30 to-primary/10 border-2 border-primary/40 flex items-center justify-center shadow-xl">
                <Cog className="h-8 w-8 sm:h-10 sm:w-10 text-primary animate-spin" style={{ animationDuration: '4s' }} />
              </div>
              <div className="text-center">
                <div className="text-[10px] sm:text-[12px] font-bold text-foreground">Automate</div>
              </div>
            </div>

            <ArrowRight className="h-4 w-4 sm:h-5 sm:w-5 text-primary/60 shrink-0" />

            {/* Step 3 */}
            <div className="relative flex flex-col items-center gap-1.5 z-10">
              <div className="h-16 w-16 sm:h-20 sm:w-20 rounded-xl bg-gradient-to-br from-success/20 to-success/5 border-2 border-success/30 flex items-center justify-center shadow-lg">
                <CheckCircle2 className="h-7 w-7 sm:h-8 sm:w-8 text-success" />
              </div>
              <div className="text-center">
                <div className="text-[10px] sm:text-[11px] font-semibold text-foreground">Results</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Animation styles */}
      <style dangerouslySetInnerHTML={{
        __html: `
          @keyframes float {
            0%, 100% { transform: translateY(0px); opacity: 0.5; }
            50% { transform: translateY(-8px); opacity: 0.8; }
          }
        `
      }} />
    </>
  );
};
