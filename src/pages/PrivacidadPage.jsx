import { Link } from 'react-router-dom';
import './LegalPage.css';
import { usePageBodyClass } from '../hooks/usePageBodyClass';

export default function PrivacidadPage() {
  usePageBodyClass('page-legal');
  return (
    <div className="legal-wrap">
      <Link className="legal-back" to="/">&larr; Volver al inicio de sesión</Link>
      <div className="legal-card">
        <h1>Política de privacidad</h1>
        <p className="legal-updated">Última actualización: 8 de septiembre de 2026</p>

        <p><b>Catering Control</b> es el software que usa la empresa de catering que te dio acceso a esta cuenta
        para gestionar sus operaciones. Esta página explica qué datos guarda la plataforma y cómo se manejan.</p>

        <h2>1. Qué datos se guardan</h2>
        <div className="legal-table-scroll">
          <table>
            <tbody>
              <tr><th>Quién</th><th>Qué se guarda</th></tr>
              <tr><td>Clientes del servicio de catering</td><td>Nombre, carnet, teléfono(s), dirección(es) de entrega, plan contratado y notas del pedido</td></tr>
              <tr><td>Personal (staff)</td><td>Nombre, correo, rol dentro del equipo</td></tr>
              <tr><td>Drivers</td><td>Nombre, carnet, teléfono, dirección, y foto de perfil (opcional)</td></tr>
            </tbody>
          </table>
        </div>

        <h2>2. Fotos</h2>
        <p>La plataforma puede generar dos tipos de imágenes:</p>
        <ul>
          <li><b>Foto de respaldo de una entrega</b> (opcional, la sube quien reparte): sirve para resolver un
          reclamo puntual sobre un pedido. Se borra automáticamente a los <b>7 días</b>.</li>
          <li><b>Comprobante de pago</b> (cuando un cliente renueva su plan desde el portal): se usa para
          verificar el pago. Se borra automáticamente a los <b>7 días</b>.</li>
        </ul>
        <p>Estas imágenes se guardan con un nombre de archivo único generado al azar (no un listado público ni
        buscable), y solo se accede a ellas desde dentro de la plataforma mientras están vigentes.</p>

        <h2>3. Cómo se usan los datos</h2>
        <p>Los datos se usan exclusivamente para operar el servicio de catering: armar rutas de reparto, calcular
        los días de plan consumidos, y que el personal y los drivers sepan qué y a quién entregar. No se venden
        ni se comparten con terceros ajenos a la empresa que administra tu cuenta.</p>

        <h2>4. Dónde se guardan</h2>
        <p>Los datos se almacenan en una base de datos con controles de acceso por usuario y por rol: cada
        sesión requiere un inicio de sesión válido, y el acceso a la información de una empresa está separado del
        de las demás empresas que usan la misma plataforma.</p>

        <h2>5. Cuánto tiempo se conservan</h2>
        <p>Los registros operativos (clientes, planes, historial de entregas) se conservan mientras la cuenta de
        la empresa esté activa. Las imágenes de respaldo y los comprobantes de pago se conservan solo 7 días,
        como se explica arriba.</p>
        <p>Además, los datos de los clientes inactivos se eliminan automáticamente de la plataforma a los <b>2 años</b>.</p>

        <h2>6. Tus derechos</h2>
        <p>Si querés consultar, corregir o pedir que se elimine tu información personal, comunicate directamente
        con la empresa de catering que administra tu cuenta — son quienes tienen control directo sobre esos
        datos dentro de la plataforma.</p>

        <h2>7. Cambios a esta política</h2>
        <p>Esta política puede actualizarse. Los cambios relevantes se reflejarán en la fecha de "Última
        actualización" de esta página.</p>

        <div className="legal-contact">
          ¿Preguntas sobre esta política? Contactá a la empresa que te dio acceso a esta cuenta, o a quien te haya provisto la plataforma.
          <br /><Link className="legal-crosslink" to="/terminos">Ver también los Términos y condiciones →</Link>
        </div>
      </div>
    </div>
  );
}
