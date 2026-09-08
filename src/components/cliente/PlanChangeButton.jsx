export default function PlanChangeButton({ onOpen }) {
  return (
    <div className="col-12">
      <button className="btn btn-primary btn-lg w-100 rounded-4 shadow-sm py-3" onClick={onOpen}>
        ¿Quieres renovar o cambiar de plan?
      </button>
    </div>
  );
}
