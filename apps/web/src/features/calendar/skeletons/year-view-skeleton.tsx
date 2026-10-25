import { Skeleton } from "@/components/ui/skeleton";

const MONTHS = Array.from({ length: 12 });

export function YearViewSkeleton() {
	return (
		<div className="hidden sm:grid grid-cols-3 gap-4 flex-grow overflow-hidden auto-rows-fr lg:grid-cols-4">
			{MONTHS.map((_, monthIndex) => (
				<div
					key={monthIndex}
					className="flex flex-col border rounded-md overflow-hidden h-full animate-pulse"
				>
					<div className="bg-primary/5 px-1 py-2 text-center">
						<Skeleton className="h-4 w-24 mx-auto" />
					</div>

					<div className="grid grid-cols-7 text-center text-xs py-2 px-1">
						{Array.from({ length: 7 }).map((_, i) => (
							<Skeleton key={i} className="h-3 w-3 mx-auto" />
						))}
					</div>

					<div className="grid grid-cols-7 gap-0 p-1 flex-grow">
						{Array.from({ length: 42 }).map((_, i) => (
							<div
								key={i}
								className="flex flex-col items-center justify-center p-1"
							>
								<Skeleton className="h-4 w-4 rounded-full" />
								<Skeleton className="h-1.5 w-3 mt-1" />
							</div>
						))}
					</div>
				</div>
			))}
		</div>
	);
}
