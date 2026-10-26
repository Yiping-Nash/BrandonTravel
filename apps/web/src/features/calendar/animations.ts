import type { Variants } from "framer-motion";

export const fadeIn: Variants = {
	initial: { opacity: 0 },
	animate: { opacity: 1 },
	exit: { opacity: 0 },
};

export const slideFromLeft: Variants = {
	initial: { x: -20, opacity: 0 },
	animate: { x: 0, opacity: 1 },
	exit: { x: 20, opacity: 0 },
};

export const slideFromRight: Variants = {
	initial: { x: 20, opacity: 0 },
	animate: { x: 0, opacity: 1 },
	exit: { x: -20, opacity: 0 },
};

export const transition = {
	type: "spring",
	stiffness: 200,
	damping: 20,
} as const;

export const staggerContainer: Variants = {
	animate: {
		transition: {
			staggerChildren: 0.1,
		},
	},
};

export const buttonHover: Variants = {
	hover: { scale: 1.05 },
	tap: { scale: 0.95 },
};
