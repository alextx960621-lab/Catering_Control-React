export default function PlanChangeButton({ onOpen }) {
  return (
    <div className="col-12">
      <button className="btn btn-primary w-100 rounded-4 shadow-sm py-2" onClick={onOpen}>
        Renovar o cambiar de plan
      </button>
    </div>
  );
}
