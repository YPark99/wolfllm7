//  TokenBalanceWidget.tsx
import { useState, useEffect } from 'react';

export default function TokenBalanceWidget() {
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    const eventSource = new EventSource('/api/token-balance');

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setBalance(data.balance);
    };

    eventSource.onerror = () => {
      console.error('Error with SSE connection');
      eventSource.close();
    };

    return () => eventSource.close();
  }, []);

  return (
    <div className="token-balance-widget">
      <h4>Token Balance</h4>
      {balance !== null ? (
        <p className="text-lg font-bold">{balance} Tokens</p>
      ) : (
        <p className="loading">Loading...</p>
      )}
      <button
       className="bg-primary text-primary-foreground px-6 py-2 rounded-lg hover:bg-secondary hover:text-secondary-foreground transition"
      >
        Пополнить баланс
      </button>
    </div>
  );
}

