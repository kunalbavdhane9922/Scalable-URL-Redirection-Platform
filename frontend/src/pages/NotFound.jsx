import { Link } from 'react-router-dom';
import { ArrowLeft, Compass } from 'lucide-react';
import { Logo } from '../components/ui.jsx';

export default function NotFound() {
  return (
    <div className="notfound">
      <div className="notfound-inner">
        <Link to="/" className="notfound-brand"><Logo /></Link>
        <span className="notfound-code">404</span>
        <h1>This code doesn’t resolve.</h1>
        <p>The page you’re looking for isn’t here. The link shortener, however, is very much alive.</p>
        <div className="notfound-actions">
          <Link to="/" className="btn btn-primary">
            <ArrowLeft size={16} />
            Back home
          </Link>
          <Link to="/dashboard" className="btn btn-ghost">
            <Compass size={16} />
            Open dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
