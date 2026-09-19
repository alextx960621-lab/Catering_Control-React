import { Link } from 'react-router-dom';

export default function WeeklyMenuButton() {
  return (
    <div className="col-12">
      <Link className="btn btn-warning w-100 rounded-4 shadow-sm py-2" to="/menu-semanal">
        🍲 Menú de la semana
      </Link>
    </div>
  );
}
