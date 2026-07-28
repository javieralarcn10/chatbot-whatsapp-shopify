import { parsePhoneNumberFromString } from "libphonenumber-js";

function resolveCountryFromPhone(phoneNumber: string): string | null {
  const normalized = phoneNumber.startsWith("+") ? phoneNumber : `+${phoneNumber}`;
  const parsed = parsePhoneNumberFromString(normalized);
  if (!parsed?.country) return null;

  const countryName = new Intl.DisplayNames(["es"], { type: "region" }).of(parsed.country);
  return countryName ? `${countryName} (${parsed.country})` : parsed.country;
}

export function phoneNumberContext(phoneNumber: string): string {
  const country = resolveCountryFromPhone(phoneNumber);
  const utcNow = new Date().toISOString();

  const countrySection = country
    ? `
		# PAÍS PROBABLE DEL CLIENTE

		Según el prefijo internacional de su número de teléfono, el país probable del cliente es: \`${country}\`.
		Trátalo como una pista de contexto (idioma, zona horaria aproximada, logística), no como un dato confirmado por el usuario.
		`
    : "";

  return `
		# FECHA Y HORA ACTUAL (UTC)

		Fecha y hora actuales en UTC: \`${utcNow}\`.
		Úsala como referencia temporal del sistema para interpretar plazos, horarios o si algo es reciente.
		${countrySection}
	`;
}
