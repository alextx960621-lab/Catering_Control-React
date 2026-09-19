import { Link } from 'react-router-dom';

export default function WeeklyMenuButton() {
  return (
    <div className="col-12">
      <Link className="btn btn-outline-secondary w-100 rounded-4 shadow-sm py-2" to="/menu-semanal" target="_blank" rel="noopener">
        🍲 Menú de la semana
      </Link>
    </div>
  );
}
