import { useEffect, useRef, useState } from 'react';
import { useSpring, motion, useMotionValue } from 'motion/react';

export function AnimatedCounter({
  value,
  prefix = '',
  suffix = '',
  formatter,
}: {
  value: number;
  prefix?: string;
  suffix?: string;
  formatter?: (n: number) => string;
}) {
  const motionValue = useMotionValue(0);
  const springValue = useSpring(motionValue, { stiffness: 100, damping: 30 });
  const [display, setDisplay] = useState(formatter ? formatter(0) : '0');
  const prevValue = useRef(0);

  useEffect(() => {
    motionValue.set(value);
  }, [value, motionValue]);

  useEffect(() => {
    const unsubscribe = springValue.on('change', (latest) => {
      const rounded = Math.round(latest);
      if (rounded !== prevValue.current) {
        prevValue.current = rounded;
        setDisplay(formatter ? formatter(rounded) : rounded.toLocaleString());
      }
    });
    return unsubscribe;
  }, [springValue, formatter]);

  return (
    <motion.span>
      {prefix}{display}{suffix}
    </motion.span>
  );
}
