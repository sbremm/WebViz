/// dot product
const inner = (as, bs) => {
    if (as.length != bs.length)
        throw TypeError(`arrays must have same length (${as.length} != ${bs.length})`);
    let s = 0;
    for (let i = 0; i < as.length; i++) {
        s += as[i] * bs[i];
    }
    return s;
}

/// generate a random integer in range `[0, max)`
const getRandomInt = (max) => {
    // TODO: use a sensible RNG strategy
    return Math.floor(Math.random() * Math.floor(max));
}

/// Svm implementation using SMO as the optimizer.
/// FIXME: seems fairly broken?
///
/// References:
/// * Kowalczyk (2017). Support Vector Machines Succinctly.
/// * Platt (1998). Sequential Minimal Optimization: A Fast Algorithm for Training Support Vector Machines.
export default class Svm {
    constructor({ X, y, C, tol, kernel, use_linear_optim }) {
        this.X = X;  // data points
        this.y = y;  // labels
        this.m = X.length;  // number of data ponts
        this.n = X[0].length;  // number of dimensions
        this.alphas = new Array(this.m).fill(0);

        this.kernel = kernel || inner;
        this.C = C;
        this.tol = tol;

        this.errors = new Array(this.m).fill(0);
        this.eps = 1e-3;

        this.b = 0;
        this.w = new Array(this.n).fill(0);
        this.use_linear_optim = use_linear_optim;
    }

    // Compute the SVM output (class prediction) for the i-th element
    output(i) {
        if (this.use_linear_optim) {
            return inner(this.w, this.X[i]) + this.b;
        } else {
            let sum = 0;
            for (let j = 0; j < this.m; j++) {
                sum += this.alphas[j] * this.y[j] * this.kernel(this.X[j], this.X[i]);
            }
            return sum - this.b;
        }
    }

    get_error(i) {
        if (0 < this.alphas[i] && this.alphas[i] < this.C) {
            // return cached error
            return this.errors[i];  // TODO: does this really always hold an up to date value?
        } else {
            // error is difference between prediction and actual label
            return this.output(i) - this.y[i];
        }
    }

    take_step(i1, i2) {
        // console.log(`take_step(${i1}, ${i2})`);
        if (i1 === i2)
            return false;

        let a1 = this.alphas[i1];
        let a2 = this.alphas[i2];
        let y1 = this.y[i1];
        let y2 = this.y[i2];
        let X1 = this.X[i1];
        let X2 = this.X[i2];
        // let E1 = this.get_error(i1);
        let E1 = this.output(i1) - y1;
        // let E2 = this.get_error(i2);
        let E2 = this.output(i2) - y2;

        // figure out if the items have the same label
        let s = y1 * y2;

        // compute bounds of new alpha2
        let L;
        let H;
        if (y1 != y2) {
            // equation 13
            L = Math.max(0, a2 - a1);
            H = Math.min(this.C, this.C + a2 - a1);
        } else {
            // equation 14
            L = Math.max(0, a2 + a1 - this.C);
            H = Math.min(this.C, a2 + a1);
        }

        if (L === H) {
            // console.log(`return false because L == H (${L} == ${H}, C = ${this.C})`);
            return false;
        }

        let k11 = this.kernel(X1, X1);
        let k12 = this.kernel(X1, X2);
        let k22 = this.kernel(X2, X2);

        let a2_new = this.suggest_new_a2({ a1, a2, y1, y2, E1, E2, L, H, k11, k12, k22 });

        // don't update the multipliers unless there's a large enough change
        if (Math.abs(a2_new - a2) < this.eps * (a2_new + a2 + this.eps)) {
            // console.log(`return false because update too small (a2 = ${a2}, a2_new = ${a2_new})`);
            return false;
        }

        // equation 18
        let a1_new = a1 + s * (a2 - a2_new);

        let b_new = this.compute_b({ E1, E2, a1, a1_new, a2, a2_new, k11, k12, k22, y1, y2 });

        this.update_alphas_b_weights(i1, i2, { a1_new, a2_new, b_new });

        // console.log(`return true`);
        return true;
    }

    update_alphas_b_weights(i1, i2, { a1_new, a2_new, b_new }) {
        let X1 = this.X[i1];
        let X2 = this.X[i2];
        let y1 = this.y[i1];
        let y2 = this.y[i2];

        let delta_b = b_new - this.b;
        let delta1 = y1 * (a1_new - this.alphas[i1]);
        let delta2 = y2 * (a2_new - this.alphas[i2]);

        this.b = b_new;

        // update weight vectors, if SVM is linear
        if (this.use_linear_optim) {
            for (let i = 0; i < this.w.length; i++) {
                this.w[i] += delta1 * X1[i] + delta2 * X2[i];
            }
        }

        // update the error cache using the new Lagrange multipliers
        for (let i = 0; i < this.m; i++) {
            if (0 < this.alphas[i] && this.alphas[i] < this.C) {
                this.errors[i] +=
                    delta1 * this.kernel(X1, this.X[i])
                    + delta2 * this.kernel(X2, this.X[i])
                    - delta_b;
            }
        }

        this.errors[i1] = 0;
        this.errors[i2] = 0;

        this.alphas[i1] = a1_new;
        this.alphas[i2] = a2_new;
    }

    suggest_new_a2({ a1, a2, y1, y2, E1, E2, L, H, k11, k12, k22 }) {
        let s = y1 * y2;

        // equation 15
        // Compute the 2nd derivative of the objective function
        // along the diagonal.
        let eta = k11 + k22 - 2 * k12;

        if (eta > 0) {
            // equation 16
            let a2_new = a2 + y2 * (E1 - E2) / eta;
            // Clip a2 to range [L, H]
            // equation 17
            const clip = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
            // console.log(`computing new a2 (eta = ${eta}, a2 = ${a2}, a2_new = ${a2_new}, clip(a2_new) = ${clip(a2_new,L,H)} E1 = ${E1}, E2 = ${E2})`);
            return clip(a2_new, L, H);
        }
        else {
            // sometimes, eta might not be positive
            // equation 19
            let f1 = y1 * (E1 + b) - a1 * k11 - s * a2 * k12;
            let f2 = y2 * (E2 + b) - s * a1 * K12 - a2 * k22;
            let L1 = a1 + s * (a2 - L);
            let H1 = a1 + s * (a2 - H);
            let psi_L = L1 * f1 + L * f2 + 0.5 * L1 * L1 * k11 + 0.5 * L * L * k22 + s * L * L1 * k12;
            let psi_H = H1 * f1 + H * f2 + 0.5 * H1 * H1 * k11 + 0.5 * H * H * k22 + s * H * H1 * k12;
            if (psi_L < psi_H - this.eps) {
                return L;
            }
            else if (psi_L > psi_H + this.eps) {
                return H;
            }
            else {
                return a2;
            }
        }
    }

    compute_b({ E1, E2, a1, a1_new, a2, a2_new, k11, k12, k22, y1, y2 }) {
        // equation 20
        let b1 = E1 + y1 * (a1_new - a1) * k11 + y2 * (a2_new - a2) * k12 + this.b;
        // equation 21
        let b2 = E2 + y1 * (a1_new - a1) * k12 + y2 * (a2_new - a2) * k22 + this.b;

        if (0 < a1_new && a1_new < this.C) {
            return b1;
        } else if (0 < a2_new && a2_new < this.C) {
            return b2;
        } else {
            return (b1 + b2) / 2;
        }
    }

    examine_example(i2) {
        console.log(`examining example #${i2}`);
        let E2 = this.get_error(i2);
        let y2 = this.y[i2];
        let a2 = this.alphas[i2];

        let r2 = E2 * y2;

        // if the KKT conditions are met, look at another sample
        if (!((r2 < -this.tol && a2 < this.C)
            || (r2 > this.tol && a2 > 0))) {
            console.log(`terminating because KKT is already met (r2 = ${r2}, a2 = ${a2})`);
            return false;
        }

        let non_bound_indices = this.non_bound_indices();
        let i1 = this.second_heuristic_to_find_matching_i1(non_bound_indices, { E2 });
        console.log(`per second heuristic, matching i2 might be ${i1} (non bound indices are ${non_bound_indices})`);

        if (i1 !== null && this.take_step(i1, i2))
            return true;

        // second heuristic B: loop over all examples with non-zero and non-C alpha
        if (non_bound_indices.length > 0) {
            let randi = getRandomInt(non_bound_indices.length);
            for (let i1 = 0; i1 < non_bound_indices.length; i1++) {
                if (this.take_step((i1 + randi) % non_bound_indices.length, i2)) {
                    return true;
                }
            }
        }

        // second heuristic C: look at all examples to try making positive progress
        let randi = getRandomInt(this.m);
        for (let i1 = 0; i1 < this.m; i1++) {
            if (this.take_step((i1 + randi) % this.m, i2)) {
                return true;
            }
        }

        // failure: skip this example
        return false;
    }

    non_bound_indices() {
        let non_bound_indices = [];
        for (let i = 0; i < this.alphas.length; i++) {
            if (0 < this.alphas[i] && this.alphas[i] < this.C) {
                non_bound_indices.push(i);
            }
        }
        return non_bound_indices;
    }

    second_heuristic_to_find_matching_i1(non_bound_indices, { E2 }) {
        if (non_bound_indices.length <= 1) {
            return null;
        }

        let i1 = null;
        let max = 0;
        for (let j of non_bound_indices) {
            let E1 = this.errors[j] - this.y[j];
            let step = Math.abs(E1 - E2);  // approximation
            if (step > max) {
                max = step;
                i1 = j;
            }
        }
        return i1;
    }

    first_heuristic() {
        let non_bound_indices = this.non_bound_indices();
        let num_changed = 0;
        for (let i of non_bound_indices) {
            num_changed += this.examine_example(i);
        }
        return num_changed;
    }

    main_routine() {
        let num_changed = 0;
        let examine_all = true;

        while (num_changed > 0 || examine_all) {
            if (examine_all) {
                num_changed = 0;
                for (let i = 0; i < this.m; i++)
                    num_changed += this.examine_example(i);
                examine_all = false;
            } else {
                num_changed = this.first_heuristic();
                examine_all = (num_changed == 0);
            }
        }
    }

    compute_weights() {
        let sum = new Array(this.n).fill(0);
        for (let i = 0; i < this.m; i++) {
            for (let j = 0; j < this.n; j++) {
                sum[j] += this.alphas[i] * this.y[i] * this.X[i][j];
            }
        }
        return sum;
    }
}