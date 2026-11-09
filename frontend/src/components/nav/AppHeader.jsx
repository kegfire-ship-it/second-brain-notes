import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, Search } from 'lucide-react';
import Logo from '@/components/ui/logo';
import AppMenu from './AppMenu';
import './appnav.css';

export function NavSearch({ value, onChange, onSubmit, placeholder = 'Search', children }) {
  return (
    <div className="appnav-search">
      <Search size={16} strokeWidth={2} className="appnav-search-ic" aria-hidden="true" />
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onSubmit ? (e) => {
          if (e.key === 'Enter') { e.preventDefault(); onSubmit(e.currentTarget.value); }
        } : undefined}
        autoComplete="off"
        autoCorrect="off"
        spellCheck="false"
        inputMode="search"
        enterKeyHint={onSubmit ? 'search' : undefined}
      />
      {children}
      {value ? (
        <button
          type="button"
          className="appnav-search-clear"
          aria-label="Clear search"
          onClick={() => onChange('')}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}

/**
 * search: { value, onChange, placeholder?, children? }
 *   children renders INSIDE the search pill (e.g. a status adornment); the
 *   component's own `children` render BESIDE the search, in the controls row.
 * menu: { top?, items? } — page-specific extras for the shared burger menu
 *   (see AppMenu); every page gets the burger even without it.
 */
export default function AppHeader({ search, children, menu }) {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  const hasControls = !!search || !!children;

  return (
    <header className="appnav">
      <div className="appnav-inner">
        <div className="appnav-navrow">
          <button
            type="button"
            className="appnav-logo"
            onClick={() => navigate('/')}
            aria-label="Second Brain notes"
          >
            <Logo />
          </button>
          <div className="appnav-menu-wrap">
            <button
              type="button"
              className="appnav-iconbtn"
              aria-label="Menu"
              aria-haspopup="dialog"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
            >
              <Menu size={18} strokeWidth={2} />
            </button>
          </div>
        </div>

        {hasControls && (
          <div className="appnav-controls">
            {search ? (
              <NavSearch
                value={search.value}
                onChange={search.onChange}
                onSubmit={search.onSubmit}
                placeholder={search.placeholder}
              >
                {search.children}
              </NavSearch>
            ) : null}
            {children}
          </div>
        )}
      </div>
      <AppMenu open={menuOpen} onClose={closeMenu} top={menu?.top} items={menu?.items} />
    </header>
  );
}
