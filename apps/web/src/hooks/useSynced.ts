import { useEffect, useState } from 'react';

/**
 * A typed box that follows its value when it changes elsewhere (Clear filters, the back button, an import)
 * but keeps what the operator typed while that text already means the value ("zz, British" for carriers ZZ;
 * "450.5" for 45050 pence). `means` turns the text into the value's string form.
 */
export function useSynced(urlValue: string, means: (text: string) => string): [string, (v: string) => void] {
  const [text, setText] = useState(urlValue);
  useEffect(() => setText((t) => (means(t) === urlValue ? t : urlValue)), [urlValue, means]);
  return [text, setText];
}
