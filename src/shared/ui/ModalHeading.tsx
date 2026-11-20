import type { ReactNode } from "react";

interface ModalHeadingProps {
    icon: ReactNode;
    title: string;
    subtitle?: ReactNode;
}

/** Title block for Mantine modals: teal icon tile, title, one-line subtitle. */
export default function ModalHeading({
    icon,
    title,
    subtitle,
}: ModalHeadingProps) {
    return (
        <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-400/10 text-teal-300 ring-1 ring-teal-300/25">
                {icon}
            </span>
            <div className="min-w-0">
                <div className="text-base font-bold tracking-tight text-white">
                    {title}
                </div>
                {subtitle && (
                    <div className="truncate text-xs text-zinc-400">
                        {subtitle}
                    </div>
                )}
            </div>
        </div>
    );
}
