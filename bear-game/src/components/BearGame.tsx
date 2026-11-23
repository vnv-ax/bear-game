'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
// динамический импорт ниже — чтобы three.js не попадал в SSR
import type { Game } from '@/game/Game';

export default function BearGame() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [progress, setProgress] = useState(0);
  const [label, setLabel] = useState('лес');
  const [ready, setReady] = useState(false);
  const [magic, setMagic] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hintsVisible, setHintsVisible] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { Game } = await import('@/game/Game');
        if (cancelled || !containerRef.current) return;
        const game = new Game(containerRef.current, {
          onProgress: (p, l) => {
            setProgress(p);
            setLabel(l);
          },
          onReady: () => setReady(true),
          onError: (m) => setError(m),
          onMagic: (on) => setMagic(on),
        });
        gameRef.current = game;
        (window as unknown as { __bearGame?: unknown }).__bearGame = game;
        await game.init();
      } catch (e) {
        if (!cancelled) setError(String((e as Error)?.message ?? e));
      }
    })();
    const hintTimer = window.setTimeout(() => setHintsVisible(false), 16000);
    return () => {
      cancelled = true;
      window.clearTimeout(hintTimer);
      gameRef.current?.dispose();
      gameRef.current = null;
    };
  }, []);

  const toggleMagic = useCallback(() => {
    gameRef.current?.setMagic(!magic);
  }, [magic]);

  const hideHints = useCallback(() => setHintsVisible(false), []);

  return (
    <div className={'bear-root' + (magic ? ' magic' : '')}>
      <div ref={containerRef} className="bear-canvas" onPointerDown={hideHints} />

      {/* заголовок */}
      <div className={'bear-title' + (ready ? ' bear-title--compact' : '')}>
        <h1>Мишка-грустишка</h1>
        <p>спокойная игра-наблюдение</p>
      </div>

      {/* подсказки */}
      <div className={'bear-hints' + (hintsVisible && ready ? '' : ' bear-hints--hidden')}>
        <span>Тяните пустое место — вращение камеры</span>
        <span>Колесо или щипок — приблизить и отдалить</span>
        <span>Клик по мишке или рядом — он может отреагировать</span>
        <span>Камень, ветку или яблоко можно схватить и бросить</span>
        <span>Держите и тяните мишку вверх — подбросите его</span>
        <span>Клик по воде — всплеск, рыба разбегается</span>
      </div>

      {/* кнопка волшебства */}
      <button
        className={'bear-magic-btn' + (magic ? ' bear-magic-btn--on' : '')}
        onClick={toggleMagic}
        aria-pressed={magic}
        aria-label="Волшебный режим"
        title="Волшебный режим"
      >
        ✦
      </button>

      {/* загрузка */}
      {!ready && !error && (
        <div className="bear-loader">
          <div className="bear-loader__paw" aria-hidden />
          <div className="bear-loader__title">Мишка-грустишка</div>
          <div className="bear-loader__bar">
            <div className="bear-loader__fill" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <div className="bear-loader__label">Просыпаемся в лесу: {label}… {Math.round(progress * 100)}%</div>
        </div>
      )}

      {error && (
        <div className="bear-loader">
          <div className="bear-loader__title">Упс, лес не проснулся</div>
          <div className="bear-loader__label">{error}</div>
          <button className="bear-retry" onClick={() => window.location.reload()}>Попробовать ещё раз</button>
        </div>
      )}
    </div>
  );
}
