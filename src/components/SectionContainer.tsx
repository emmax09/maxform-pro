import { cn } from "@/lib/utils";

interface SectionContainerProps {
  children: React.ReactNode;
  className?: string;
  id?: string;
}

export const SectionContainer = ({ children, className, id }: SectionContainerProps) => {
  return (
    <section id={id} className={cn("relative z-10 py-16 sm:py-24 px-4 sm:px-6 overflow-hidden", className)}>
      <div className="mx-auto max-w-[1200px]">
        {children}
      </div>
    </section>
  );
};

interface SectionHeaderProps {
  badge?: string;
  title: string;
  description?: string;
  centered?: boolean;
}

export const SectionHeader = ({ badge, title, description, centered = true }: SectionHeaderProps) => {
  return (
    <div className={cn("mb-12 sm:mb-16", centered && "text-center")}>
      {badge && (
        <p className="text-[12px] sm:text-[13px] uppercase tracking-[0.15em] text-muted-foreground mb-3 sm:mb-4 font-medium">
          {badge}
        </p>
      )}
      <h2 className="text-[clamp(1.5rem,4vw,2.5rem)] font-medium tracking-[-0.03em] text-foreground leading-[1.15]">
        {title}
      </h2>
      {description && (
        <p className="mt-3 sm:mt-4 text-[14px] sm:text-[16px] text-muted-foreground max-w-[600px] mx-auto">
          {description}
        </p>
      )}
    </div>
  );
};

interface CardProps {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
}

export const Card = ({ children, className, hover = false }: CardProps) => {
  return (
    <div 
      className={cn(
        "border-2 border-border bg-card/50 backdrop-blur-xs",
        hover && "hover:border-primary/20 hover:shadow-lg transition-all duration-300",
        className
      )}
    >
      {children}
    </div>
  );
};

interface FeatureCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  className?: string;
}

export const FeatureCard = ({ icon, title, description, className }: FeatureCardProps) => {
  return (
    <Card hover className={cn("p-6 sm:p-8 rounded-xl", className)}>
      <div className="h-12 w-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
        {icon}
      </div>
      <h3 className="text-[16px] sm:text-[18px] font-medium text-foreground mb-2 sm:mb-3">
        {title}
      </h3>
      <p className="text-[13px] sm:text-[14px] leading-[1.6] text-muted-foreground">
        {description}
      </p>
    </Card>
  );
};

export const Divider = () => {
  return <div className="relative z-10 w-full border-t-2 border-border" />;
};
