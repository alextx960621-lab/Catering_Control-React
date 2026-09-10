import { Link } from 'react-router-dom';
import './LegalPage.css';

export default function TerminosPage() {
  return (
    <div className="legal-wrap">
      <Link className="legal-back" to="/">&larr; Volver al inicio de sesión</Link>
      <div className="legal-card">
        <h1>Términos y condiciones de uso</h1>
        <p className="legal-updated">Última actualización: 8 de septiembre de 2026</p>

        <p>Estos términos regulan el uso de <b>Catering Control</b> ("el software", "la plataforma"), un sistema de
        gestión para empresas de catering provisto a la empresa que te dio acceso a esta cuenta ("la empresa").
        Al iniciar sesión, aceptás estos términos.</p>

        <div className="legal-toc">
          <p>Índice</p>
          <ol>
            <li><a href="#s1">Quién usa esta plataforma</a></li>
            <li><a href="#s2">Cuentas y acceso</a></li>
            <li><a href="#s3">Uso aceptable</a></li>
            <li><a href="#s4">Disponibilidad del servicio</a></li>
            <li><a href="#s5">Datos e imágenes</a></li>
            <li><a href="#s6">El servicio se ofrece "tal cual"</a></li>
            <li><a href="#s7">Exclusión de responsabilidad</a></li>
            <li><a href="#s8">Indemnización</a></li>
            <li><a href="#s9">Ley aplicable</a></li>
            <li><a href="#s10">Cambios a estos términos</a></li>
          </ol>
        </div>

        <h2 id="s1">1. Quién usa esta plataforma</h2>
        <p>Catering Control se ofrece a empresas de catering para que gestionen sus operaciones (clientes, planes,
        rutas, entregas y personal). Si estás usando esta plataforma como cliente final de una de esas empresas
        (portal de autoservicio), tu relación contractual por el servicio de catering en sí es con esa empresa,
        no con Catering Control.</p>

        <h2 id="s2">2. Cuentas y acceso</h2>
        <ul>
          <li>Cada usuario (staff, driver o cliente) es responsable de mantener la confidencialidad de su contraseña.</li>
          <li>El acceso se bloquea temporalmente después de varios intentos fallidos de inicio de sesión, como medida de seguridad.</li>
          <li>La empresa administradora de la cuenta puede crear, editar o revocar el acceso de sus usuarios en cualquier momento.</li>
        </ul>

        <h2 id="s3">3. Uso aceptable</h2>
        <p>No está permitido usar la plataforma para almacenar información falsa a sabiendas, intentar acceder a
        datos de otra empresa distinta a la propia, ni intentar vulnerar las medidas de seguridad del sistema.</p>

        <h2 id="s4">4. Disponibilidad del servicio</h2>
        <p>Se procura mantener la plataforma disponible de forma continua, pero pueden ocurrir interrupciones
        programadas o no programadas por mantenimiento, actualizaciones, o factores fuera de nuestro control
        (por ejemplo, el proveedor de infraestructura). La plataforma incluye una función de respaldo local para
        seguir operando ante cortes de conexión breves.</p>

        <h2 id="s5">5. Datos e imágenes</h2>
        <p>El tratamiento de los datos personales que se cargan en la plataforma (de clientes, personal y drivers)
        se describe en la <Link className="legal-crosslink" to="/privacidad">Política de privacidad</Link>, que forma parte de estos
        términos.</p>

        <h2 id="s6">6. El servicio se ofrece "tal cual"</h2>
        <div className="legal-summary"><b>En resumen:</b> la plataforma se ofrece sin garantías de funcionamiento perfecto o ininterrumpido; se usa bajo el propio riesgo de quien la usa.</div>
        <p>La plataforma se ofrece "tal cual" y "según disponibilidad", sin garantías de ningún tipo, expresas o
        implícitas, incluyendo (sin limitarse a) garantías de que funcionará sin errores, de forma ininterrumpida,
        o de que se ajustará a un propósito particular. El uso de la plataforma es bajo el propio riesgo de quien
        la usa.</p>

        <h2 id="s7">7. Exclusión de responsabilidad</h2>
        <div className="legal-summary"><b>En resumen:</b> Catering Control no responde por daños indirectos derivados del uso de la plataforma; la empresa que la usa es responsable de sus propias decisiones operativas y de su relación con sus clientes.</div>
        <p>En la máxima medida permitida por la ley, Catering Control (y quien lo provee) no será responsable por
        daños indirectos, incidentales, especiales o derivados (incluyendo pérdida de ganancias, de clientes o de
        datos) que resulten del uso o la imposibilidad de uso de la plataforma, incluso si se avisó de la
        posibilidad de esos daños. Esto no aplica a daños causados por dolo o negligencia grave, que la ley no
        permite excluir.</p>
        <p>La empresa que usa la plataforma es responsable de la exactitud de los datos que carga, de las
        decisiones operativas que tome con esa información (rutas, entregas, cobros), y de su propia relación con
        sus clientes finales. La plataforma es una herramienta de gestión, no reemplaza ese criterio.</p>

        <h2 id="s8">8. Indemnización</h2>
        <div className="legal-summary"><b>En resumen:</b> la empresa que usa la plataforma responde por reclamos derivados de su mal uso, del incumplimiento de estos términos, o de reclamos de sus propios clientes por el servicio de catering.</div>
        <p>La empresa que usa la plataforma se compromete a responder por cualquier reclamo, daño o gasto
        (incluyendo honorarios legales razonables) que surja de: (a) el uso indebido de la plataforma, (b) el
        incumplimiento de estos términos, o (c) reclamos de sus propios clientes finales relacionados con el
        servicio de catering en sí (no con el funcionamiento técnico de la plataforma).</p>

        <h2 id="s9">9. Ley aplicable</h2>
        <p>Estos términos se rigen por las leyes del Estado Plurinacional de Bolivia. Cualquier disputa se
        someterá a los tribunales competentes de Bolivia, salvo que ambas partes acuerden otra cosa por escrito.</p>

        <h2 id="s10">10. Cambios a estos términos</h2>
        <p>Estos términos pueden actualizarse. Los cambios relevantes se reflejarán en la fecha de "Última
        actualización" de esta página.</p>

        <div className="legal-contact">
          ¿Preguntas sobre estos términos? Contactá a la empresa que te dio acceso a esta cuenta, o a quien te haya provisto la plataforma.
          <br /><Link className="legal-crosslink" to="/privacidad">Ver también la Política de privacidad →</Link>
        </div>
      </div>
    </div>
  );
}
