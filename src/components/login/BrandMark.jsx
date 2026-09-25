import { useState } from 'react';

export default function BrandMark({ logo, name }) {
  const [broken, setBroken] = useState(false);

  if (logo && !broken) {
    return <img src={logo} alt={name} onError={() => setBroken(true)} />;
  }
  return <>🍽</>;
}
