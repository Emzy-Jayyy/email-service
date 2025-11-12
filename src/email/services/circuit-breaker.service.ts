// src/email/services/circuit-breaker.service.ts
import { Injectable, Logger } from '@nestjs/common';

enum CircuitState {
  CLOSED = 'CLOSED', // Normal operation
  OPEN = 'OPEN', // Failing, reject requests
  HALF_OPEN = 'HALF_OPEN', // Testing if service recovered
}

interface CircuitBreaker {
  state: CircuitState;
  failure_count: number;
  success_count: number;
  last_failure_time: number | null;
  next_attempt_time: number;
}

@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);
  private circuits: Map<string, CircuitBreaker> = new Map();

  private readonly FAILURE_THRESHOLD = 5; // Open circuit after 5 failures
  private readonly SUCCESS_THRESHOLD = 2; // Close circuit after 2 successes in half-open
  private readonly TIMEOUT = 60000; // Wait 60s before trying again (half-open)
  private readonly HALF_OPEN_MAX_CALLS = 3; // Max calls to test in half-open state

  async execute<T>(
    operation: () => Promise<T>,
    circuit_name: string,
  ): Promise<T> {
    const circuit = this.getOrCreateCircuit(circuit_name);

    // Check if circuit is open
    if (circuit.state === CircuitState.OPEN) {
      const now = Date.now();

      if (now < circuit.next_attempt_time) {
        // Circuit is still open, reject immediately
        this.logger.warn(
          `⚠️ Circuit breaker [${circuit_name}] is OPEN. Request rejected.`,
        );
        throw new Error(`Circuit breaker is OPEN for ${circuit_name}`);
      }

      // Timeout elapsed, transition to half-open
      circuit.state = CircuitState.HALF_OPEN;
      circuit.success_count = 0;
      this.logger.log(
        `🔄 Circuit breaker [${circuit_name}] transitioning to HALF_OPEN`,
      );
    }

    try {
      // Execute the operation
      const result = await operation();

      // Operation succeeded
      this.onSuccess(circuit, circuit_name);

      return result;
    } catch (error) {
      // Operation failed
      this.onFailure(circuit, circuit_name);
      throw error;
    }
  }

  private onSuccess(circuit: CircuitBreaker, circuit_name: string) {
    circuit.failure_count = 0;

    if (circuit.state === CircuitState.HALF_OPEN) {
      circuit.success_count++;

      if (circuit.success_count >= this.SUCCESS_THRESHOLD) {
        // Recovered! Close the circuit
        circuit.state = CircuitState.CLOSED;
        circuit.success_count = 0;
        this.logger.log(
          `✅ Circuit breaker [${circuit_name}] is now CLOSED (recovered)`,
        );
      }
    }
  }

  private onFailure(circuit: CircuitBreaker, circuit_name: string) {
    circuit.failure_count++;
    circuit.last_failure_time = Date.now();

    if (circuit.state === CircuitState.HALF_OPEN) {
      // Failed during testing, reopen circuit
      circuit.state = CircuitState.OPEN;
      circuit.next_attempt_time = Date.now() + this.TIMEOUT;
      circuit.success_count = 0;

      this.logger.error(
        `Circuit breaker [${circuit_name}] reopened after failure in HALF_OPEN state`,
      );
    } else if (circuit.failure_count >= this.FAILURE_THRESHOLD) {
      // Too many failures, open the circuit
      circuit.state = CircuitState.OPEN;
      circuit.next_attempt_time = Date.now() + this.TIMEOUT;

      this.logger.error(
        `Circuit breaker [${circuit_name}] is now OPEN after ${circuit.failure_count} failures`,
      );
    }
  }

  private getOrCreateCircuit(circuit_name: string): CircuitBreaker {
    if (!this.circuits.has(circuit_name)) {
      this.circuits.set(circuit_name, {
        state: CircuitState.CLOSED,
        failure_count: 0,
        success_count: 0,
        last_failure_time: null,
        next_attempt_time: 0,
      });
    }

    return this.circuits.get(circuit_name)!;
  }

  getCircuitStatus(circuit_name: string): CircuitBreaker | null {
    return this.circuits.get(circuit_name) || null;
  }

  getAllCircuits(): Map<string, CircuitBreaker> {
    return new Map(this.circuits);
  }

  resetCircuit(circuit_name: string): void {
    this.circuits.delete(circuit_name);
    this.logger.log(`🔄 Circuit breaker [${circuit_name}] has been reset`);
  }
}
