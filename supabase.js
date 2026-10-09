/* Supabase Minimal Browser Client Bundle */
/* Supabase Standard Local Browser Client Bridge */
// Clean local bridge for Supabase requests
(function (global) {
    global.supabase = {
        createClient: function (url, key) {
            const cleanUrl = url.replace(/\/$/, "");
            const cleanKey = key.trim();

            return {
                from: function (tableName) {
                    return {
                        select: function () {
                            return {
                                order: function (column = 'created_at', options = { ascending: false }) {
                                    const dir = options.ascending ? 'asc' : 'desc';
                                    const endpoint = `${cleanUrl}/rest/v1/${tableName}?select=*&order=${column}.${dir}&apikey=${cleanKey}`;
                                    
                                    return fetch(endpoint, {
                                        method: "GET",
                                        headers: {
                                            "apikey": cleanKey,
                                            "Authorization": `Bearer ${cleanKey}`,
                                            "Content-Type": "application/json"
                                        }
                                    })
                                    .then(async res => {
                                        const json = await res.json();
                                        return res.ok ? { data: json, error: null } : { data: null, error: json };
                                    })
                                    .catch(err => ({ data: null, error: err }));
                                }
                            };
                        },

                        insert: function (payload) {
                            const endpoint = `${cleanUrl}/rest/v1/${tableName}?apikey=${cleanKey}`;
                            
                            return fetch(endpoint, {
                                method: "POST",
                                headers: {
                                    "apikey": cleanKey,
                                    "Authorization": `Bearer ${cleanKey}`,
                                    "Content-Type": "application/json",
                                    "Prefer": "return=representation"
                                },
                                body: JSON.stringify(payload)
                            })
                            .then(async res => {
                                const json = await res.json();
                                return res.ok ? { data: json, error: null } : { data: null, error: json };
                            })
                            .catch(err => ({ data: null, error: err }));
                        },

                        upsert: function (payload) {
                            const endpoint = `${cleanUrl}/rest/v1/${tableName}?apikey=${cleanKey}`;

                            return fetch(endpoint, {
                                method: "POST",
                                headers: {
                                    "apikey": cleanKey,
                                    "Authorization": `Bearer ${cleanKey}`,
                                    "Content-Type": "application/json",
                                    "Prefer": "resolution=merge-duplicates,return=representation"
                                },
                                body: JSON.stringify(payload)
                            })
                                .then(async res => {
                                    const json = await res.json();
                                    return res.ok ? { data: json, error: null } : { data: null, error: json };
                                })
                                .catch(err => ({ data: null, error: err }));
                        },

                        delete: function () {
                            return {
                                eq: function (column, value) {
                                    const endpoint = `${cleanUrl}/rest/v1/${tableName}?${encodeURIComponent(column)}=eq.${encodeURIComponent(value)}&apikey=${cleanKey}`;

                                    return fetch(endpoint, {
                                        method: "DELETE",
                                        headers: {
                                            "apikey": cleanKey,
                                            "Authorization": `Bearer ${cleanKey}`,
                                            "Content-Type": "application/json"
                                        }
                                    })
                                        .then(async res => {
                                            const json = res.status === 204 ? null : await res.json();
                                            return res.ok ? { data: json, error: null } : { data: null, error: json };
                                        })
                                        .catch(err => ({ data: null, error: err }));
                                }
                            };
                        }
                    };
                }
            };
        }
    };
})(typeof globalThis !== "undefined" ? globalThis : self);