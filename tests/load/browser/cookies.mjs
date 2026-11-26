export function browserCookies(cookies, baseUrl) {
  return cookies.map((cookie) => {
    const options = cookie.options ?? cookie,
      value = options.sameSite ?? "lax",
      sameSite =
        value === true
          ? "Strict"
          : value === false
            ? "None"
            : { lax: "Lax", strict: "Strict", none: "None" }[String(value).toLowerCase()];
    if (!sameSite) throw Error("Unsupported issued cookie policy");
    return {
      name: cookie.name,
      value: cookie.value,
      url: baseUrl,
      httpOnly: options.httpOnly ?? false,
      secure: options.secure ?? true,
      sameSite,
    };
  });
}
