export default function Footer() {
  return (
    <footer className="w-full bg-surface-container-lowest/60 border-t border-outline-variant/20 py-6">
      <div className="w-full px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-on-surface-variant">
        <div className="flex items-center gap-2">
          <span>Glacier AI • Encrypted Enterprise Workspace</span>
        </div>
        <div className="flex items-center gap-6">
          <a className="hover:text-primary transition-colors" href="#">
            API Specs
          </a>
          <a className="hover:text-primary transition-colors" href="#">
            Data Governance
          </a>
          <a className="hover:text-primary transition-colors" href="#">
            System Status
          </a>
        </div>
      </div>
    </footer>
  );
}
